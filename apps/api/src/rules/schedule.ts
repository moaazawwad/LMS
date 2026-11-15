/**
 * Time zone logic. All instants are stored in UTC.
 * - Weekly slots live on the STUDENT's clock, so their local time never moves
 *   when daylight saving changes; the Cairo time is what shifts.
 * - Teacher availability lives on the TEACHER's clock (Cairo).
 */
import { DateTime } from 'luxon';

export const ACADEMY_TZ = 'Africa/Cairo';

export interface SlotRule {
  /** ISO weekday, 1 = Monday ... 7 = Sunday */
  weekday: number;
  /** "HH:mm" */
  startTime: string;
}

export interface Window {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export interface Busy {
  startsAt: Date;
  durationMin: number;
}

export function parseHHmm(value: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!m) throw new Error(`bad time "${value}", expected HH:mm`);
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) throw new Error(`bad time "${value}"`);
  return { hour, minute };
}

/** Every lesson instant (UTC) for the given weekly slots between two local dates, inclusive. */
export function occurrencesInRange(input: {
  timezone: string;
  slots: SlotRule[];
  fromDate: string;
  toDate: string;
}): Date[] {
  const out: Date[] = [];
  let day = DateTime.fromISO(input.fromDate, { zone: input.timezone }).startOf(
    'day',
  );
  const last = DateTime.fromISO(input.toDate, { zone: input.timezone }).startOf(
    'day',
  );
  if (!day.isValid || !last.isValid)
    throw new Error('invalid date or time zone');
  while (day <= last) {
    for (const slot of input.slots) {
      if (slot.weekday !== day.weekday) continue;
      const { hour, minute } = parseHHmm(slot.startTime);
      const local = DateTime.fromObject(
        { year: day.year, month: day.month, day: day.day, hour, minute },
        { zone: input.timezone },
      );
      out.push(local.toUTC().toJSDate());
    }
    day = day.plus({ days: 1 });
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

/** UTC bounds of one local calendar day. */
export function dayBounds(
  localDate: string,
  timezone: string,
): { from: Date; to: Date } {
  const start = DateTime.fromISO(localDate, { zone: timezone }).startOf('day');
  return { from: start.toJSDate(), to: start.plus({ days: 1 }).toJSDate() };
}

export function localDateOf(instant: Date, timezone: string): string {
  return DateTime.fromJSDate(instant, { zone: timezone }).toISODate()!;
}

export function formatInZone(
  instant: Date,
  timezone: string,
  format = 'ccc, LLL d · h:mm a',
): string {
  return DateTime.fromJSDate(instant, { zone: timezone }).toFormat(format);
}

export function overlaps(a: Busy, b: Busy): boolean {
  const aStart = a.startsAt.getTime();
  const bStart = b.startsAt.getTime();
  return (
    aStart < bStart + b.durationMin * 60_000 &&
    bStart < aStart + a.durationMin * 60_000
  );
}

const DAY_MIN = 1440;
const WEEK_MIN = 7 * DAY_MIN;

/**
 * The teacher's weekly windows as one timeline from Monday 00:00 (minutes),
 * with windows that touch or overlap joined: 9-12 and 12-15 make 9-15, and
 * Wednesday until midnight plus Thursday from midnight make one stretch.
 */
function weeklyStretches(windows: Window[]): [number, number][] {
  const raw = windows
    .map((w): [number, number] => [
      (w.weekday - 1) * DAY_MIN + w.startMinute,
      (w.weekday - 1) * DAY_MIN + w.endMinute,
    ])
    .sort((a, b) => a[0] - b[0]);
  // A second copy one week on lets Sunday night run into Monday.
  const twice = [
    ...raw,
    ...raw.map(([a, b]): [number, number] => [a + WEEK_MIN, b + WEEK_MIN]),
  ];
  const merged: [number, number][] = [];
  for (const [a, b] of twice) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged;
}

/**
 * Does a lesson sit inside the teacher's hours (teacher's own clock)? Back-to-back
 * windows count as one, also across midnight.
 */
export function fitsAvailability(
  windows: Window[],
  startsAt: Date,
  durationMin: number,
  teacherTz = ACADEMY_TZ,
): boolean {
  const local = DateTime.fromJSDate(startsAt, { zone: teacherTz });
  const start = (local.weekday - 1) * DAY_MIN + local.hour * 60 + local.minute;
  const end = start + durationMin;
  return weeklyStretches(windows).some(([a, b]) => a <= start && end <= b);
}

/** "Thu 12:00 PM–12:00 AM" on the teacher's clock, or null when they have no hours that day (for messages). */
export function hoursOnDay(
  windows: Window[],
  startsAt: Date,
  teacherTz = ACADEMY_TZ,
): string | null {
  const local = DateTime.fromJSDate(startsAt, { zone: teacherTz });
  const day = local.toFormat('ccc');
  const mine = windows
    .filter((w) => w.weekday === local.weekday)
    .sort((a, b) => a.startMinute - b.startMinute);
  if (!mine.length) return null;
  const clock = (m: number) =>
    DateTime.fromObject({
      hour: Math.floor(m / 60) % 24,
      minute: m % 60,
    }).toFormat('h:mm a');
  return `${day} ${mine.map((w) => `${clock(w.startMinute)}–${clock(w.endMinute)}`).join(', ')}`;
}

/**
 * Times a student can move a lesson to on one of THEIR local days:
 * inside the teacher's availability, not clashing with anything booked,
 * and at least `minNoticeHours` from now.
 */
export function freeSlotsForDay(input: {
  teacherWindows: Window[];
  teacherTz?: string;
  booked: Busy[];
  studentTz: string;
  localDate: string;
  durationMin: number;
  now: Date;
  minNoticeHours: number;
  stepMin?: number;
}): Date[] {
  const step = input.stepMin ?? 60;
  const earliest = input.now.getTime() + input.minNoticeHours * 3_600_000;
  const dayStart = DateTime.fromISO(input.localDate, {
    zone: input.studentTz,
  }).startOf('day');
  const dayEnd = dayStart.plus({ days: 1 });
  const out: Date[] = [];
  for (let t = dayStart; t < dayEnd; t = t.plus({ minutes: step })) {
    const startsAt = t.toUTC().toJSDate();
    if (startsAt.getTime() < earliest) continue;
    if (
      !fitsAvailability(
        input.teacherWindows,
        startsAt,
        input.durationMin,
        input.teacherTz ?? ACADEMY_TZ,
      )
    )
      continue;
    const candidate = { startsAt, durationMin: input.durationMin };
    if (input.booked.some((b) => overlaps(candidate, b))) continue;
    out.push(startsAt);
  }
  return out;
}

/**
 * Weekly start times (on the student's clock) that work every week of a
 * date range: inside the teacher's hours and clear of anything booked.
 * Used to suggest recurring slots when booking a subscription, so the check
 * runs over the whole first cycle and catches clock changes inside it.
 */
export function weeklyFreeTimes(input: {
  timezone: string;
  fromDate: string;
  toDate: string;
  durationMin: number;
  stepMin: number;
  windows: Window[];
  teacherTz?: string;
  busy: Busy[];
}): { weekday: number; times: string[] }[] {
  const result: { weekday: number; times: string[] }[] = [];
  for (let weekday = 1; weekday <= 7; weekday++) {
    const times: string[] = [];
    for (
      let minute = 0;
      minute + input.durationMin <= 24 * 60;
      minute += input.stepMin
    ) {
      const startTime = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
      const dates = occurrencesInRange({
        timezone: input.timezone,
        slots: [{ weekday, startTime }],
        fromDate: input.fromDate,
        toDate: input.toDate,
      });
      if (!dates.length) continue;
      const ok = dates.every(
        (startsAt) =>
          fitsAvailability(
            input.windows,
            startsAt,
            input.durationMin,
            input.teacherTz,
          ) &&
          !input.busy.some((b) =>
            overlaps({ startsAt, durationMin: input.durationMin }, b),
          ),
      );
      if (ok) times.push(startTime);
    }
    result.push({ weekday, times });
  }
  return result;
}
