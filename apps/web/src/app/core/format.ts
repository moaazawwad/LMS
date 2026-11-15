/** Date helpers built on Intl, so any IANA zone works without extra libraries. */

export const ACADEMY_TZ = 'Africa/Cairo';
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function time(iso: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(
    new Date(iso),
  );
}

export function day(iso: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(iso));
}

export function dayTime(iso: string | Date, timeZone: string): string {
  return `${day(iso, timeZone)} · ${time(iso, timeZone)}`;
}

/** "YYYY-MM-DD" of an instant in a zone. */
export function localDate(iso: string | Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Short city name from a zone: "America/New_York" -> "New York". */
export function city(timeZone: string): string {
  return (timeZone.split('/').pop() ?? timeZone).replace(/_/g, ' ');
}

export function minutesToClock(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function money(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

export function tierLabel(tier: string | null): string {
  return tier ? tier.charAt(0) + tier.slice(1).toLowerCase() : '—';
}

const TYPE_LABELS: Record<string, string> = {
  REGULAR: 'Regular',
  FIRST_LESSON: 'First lesson',
  RETURNING: 'Returning',
  EXTRA: 'Extra',
  TRANSFERRED: 'Transferred',
  RESCHEDULED: 'Rescheduled',
  TRIAL: 'Trial (free)',
};
export function typeLabel(type: string, extraReason?: string | null): string {
  if (type === 'EXTRA' && extraReason === 'MAKEUP') return 'Extra · makeup';
  return TYPE_LABELS[type] ?? type;
}

/** Minutes the zone is ahead of UTC at that instant (Cairo in summer = 180). */
export function tzOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** The UTC instant of a wall-clock date and time ("2026-11-03", "09:00") in a zone. */
export function zonedTimeToUtc(date: string, hhmm: string, timeZone: string): Date {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  // Two passes settle the offset, including on clock-change days.
  let guess = wall - tzOffsetMinutes(new Date(wall), timeZone) * 60_000;
  guess = wall - tzOffsetMinutes(new Date(guess), timeZone) * 60_000;
  return new Date(guess);
}

/** ISO weekday (1 = Monday) of a calendar date. */
export function isoWeekday(date: string): number {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  return dow === 0 ? 7 : dow;
}

/** The first date on or after `from` that falls on an ISO weekday. */
export function nextWeekday(from: string, weekday: number): string {
  const diff = (weekday - isoWeekday(from) + 7) % 7;
  return addDays(from, diff);
}

/** Zones students are most likely in first, then every other zone. */
export function timeZones(): string[] {
  const common = [
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Phoenix',
    'America/Los_Angeles',
    'America/Anchorage',
    'Pacific/Honolulu',
    'America/Toronto',
    'America/Winnipeg',
    'America/Edmonton',
    'America/Vancouver',
    'America/Halifax',
    'America/St_Johns',
    'Australia/Sydney',
    'Australia/Melbourne',
    'Australia/Brisbane',
    'Australia/Adelaide',
    'Australia/Perth',
    'Africa/Cairo',
  ];
  const all =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return [...common, ...all.filter((z) => !common.includes(z))];
}

/** The 42 days (6 weeks, Sunday first) a month view shows for "YYYY-MM". */
export function monthGrid(month: string): string[] {
  const first = `${month}-01`;
  const dow = new Date(`${first}T12:00:00Z`).getUTCDay();
  const start = addDays(first, -dow);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** "2026-10" moved by `step` months. */
export function shiftMonth(month: string, step: number): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + step, 1)).toISOString().slice(0, 7);
}

/** Last day of a month, "2026-10" -> "2026-10-31". */
export function monthEnd(month: string): string {
  return addDays(`${shiftMonth(month, 1)}-01`, -1);
}

/** "1 h earlier" / "30 min later" for a move on the Cairo clock. */
export function shiftText(minutes: number): string {
  const size =
    Math.abs(minutes) % 60 === 0 ? `${Math.abs(minutes) / 60} h` : `${Math.abs(minutes)} min`;
  return `${size} ${minutes < 0 ? 'earlier' : 'later'}`;
}
