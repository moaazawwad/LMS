/**
 * Billing rules: fixed 28-day prepaid cycles, priced per lesson.
 * Dates here are local calendar dates ("YYYY-MM-DD") in the subscription's zone.
 */
import { DateTime } from 'luxon';

export const CYCLE_DAYS = 28;
export const WEEKS_PER_CYCLE = 4;

/** Hours a cycle each level gives, unless a plan says otherwise. */
export const DEFAULT_HOURS_PER_CYCLE: Record<
  'BASIC' | 'STANDARD' | 'PREMIUM',
  number
> = { BASIC: 4, STANDARD: 8, PREMIUM: 12 };

/**
 * Lessons a week a plan gives: its hours per cycle spread evenly over the
 * 4 weeks. 8 hours of 60-minute lessons = 2 a week. null when they do not
 * spread evenly (e.g. 8 hours of 45-minute lessons) or exceed one a day.
 */
export function lessonsPerWeekFor(plan: {
  hoursPerCycle: number;
  lessonMinutes: number;
}): number | null {
  if (plan.hoursPerCycle <= 0 || plan.lessonMinutes <= 0) return null;
  const perWeek =
    (plan.hoursPerCycle * 60) / plan.lessonMinutes / WEEKS_PER_CYCLE;
  return Number.isInteger(perWeek) && perWeek >= 1 && perWeek <= 7
    ? perWeek
    : null;
}

/** Hours of lessons a cycle gives at `lessonsPerWeek` lessons of `lessonMinutes`. */
export function hoursPerCycleFor(
  lessonsPerWeek: number,
  lessonMinutes: number,
) {
  return (lessonsPerWeek * WEEKS_PER_CYCLE * lessonMinutes) / 60;
}

/**
 * The plan a number of lessons a week falls under. Plans are steps by hours:
 * the biggest plan whose hours the lessons reach. Below the smallest plan's
 * hours it is still the smallest plan. With Basic 4 h, Standard 8 h and
 * Premium 12 h of 60-minute lessons: 1 a week = Basic, 2 = Standard,
 * 3 or more = Premium. null when there is no plan to pick.
 */
export function planForLessons<
  P extends { hoursPerCycle: number; lessonMinutes: number },
>(plans: P[], lessonsPerWeek: number): P | null {
  if (!plans.length) return null;
  const byHours = [...plans].sort((a, b) => a.hoursPerCycle - b.hoursPerCycle);
  let pick = byHours[0];
  for (const p of byHours)
    if (hoursPerCycleFor(lessonsPerWeek, p.lessonMinutes) >= p.hoursPerCycle)
      pick = p;
  return pick;
}

export interface CycleRange {
  index: number;
  startDate: string;
  endDate: string;
}

/** Cycle `index` (1-based) of a subscription that started on `subscriptionStart`. */
export function cycleRange(
  subscriptionStart: string,
  index: number,
): CycleRange {
  if (index < 1) throw new Error('cycle index starts at 1');
  const start = DateTime.fromISO(subscriptionStart, { zone: 'utc' }).plus({
    days: (index - 1) * CYCLE_DAYS,
  });
  return {
    index,
    startDate: start.toISODate()!,
    endDate: start.plus({ days: CYCLE_DAYS - 1 }).toISODate()!,
  };
}

/** Which cycle a local date falls in (1-based). */
export function cycleIndexFor(
  subscriptionStart: string,
  localDate: string,
): number {
  const start = DateTime.fromISO(subscriptionStart, { zone: 'utc' });
  const day = DateTime.fromISO(localDate, { zone: 'utc' });
  const days = Math.floor(day.diff(start, 'days').days);
  if (days < 0) throw new Error('date is before the subscription start');
  return Math.floor(days / CYCLE_DAYS) + 1;
}

export interface InvoiceAmounts {
  lessonsCount: number;
  /** extra lessons (not makeups) added on top of the plan */
  extraCount: number;
  creditsApplied: number;
  billedLessons: number;
  totalCents: number;
}

/**
 * Invoice for one cycle: lessons per week x 4, plus extra lessons, minus
 * pending credits. Credits beyond that stay pending for the next invoice.
 */
export function invoiceFor(input: {
  lessonsPerWeek: number;
  priceCents: number;
  pendingCredits: number;
  extraLessons?: number;
  /** bill this many lessons instead of the whole cycle (a cycle cut short) */
  lessonsCount?: number;
}): InvoiceAmounts {
  const lessonsCount = Math.max(
    0,
    Math.floor(input.lessonsCount ?? input.lessonsPerWeek * WEEKS_PER_CYCLE),
  );
  const extraCount = Math.max(0, input.extraLessons ?? 0);
  const creditsApplied = Math.min(
    Math.max(0, input.pendingCredits),
    lessonsCount + extraCount,
  );
  const billedLessons = lessonsCount + extraCount - creditsApplied;
  return {
    lessonsCount,
    extraCount,
    creditsApplied,
    billedLessons,
    totalCents: billedLessons * input.priceCents,
  };
}

export function invoiceNumber(sequence: number): string {
  return `INV-${String(sequence).padStart(4, '0')}`;
}

/** Lessons of a new cycle a student may take before paying its invoice. */
export const UNPAID_GRACE_LESSONS = 2;

export const PAYMENT_METHODS = [
  'BANK_TRANSFER',
  'INSTAPAY',
  'WALLET',
  'CARD',
  'PAYPAL',
  'CASH',
  'OTHER',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type UnpaidStep =
  | { step: 'NOTHING' }
  | { step: 'GRACE'; taken: number; left: number }
  | { step: 'HOLD'; why: 'GRACE_USED' | 'CYCLE_ENDED' };

/**
 * Where an invoice stands once its cycle has started. Prepaid, so an open
 * invoice is late from day 1: the student still takes `grace` lessons (2),
 * reminded at each, then the rest of the lessons are taken off until it is paid.
 */
export function unpaidStep(input: {
  status: 'OPEN' | 'PAID' | 'VOID';
  totalCents: number;
  /** lessons of this cycle already taken (see countsAsTaken) */
  lessonsTaken: number;
  cycleEnded: boolean;
  grace?: number;
}): UnpaidStep {
  if (input.status !== 'OPEN' || input.totalCents <= 0)
    return { step: 'NOTHING' };
  const grace = input.grace ?? UNPAID_GRACE_LESSONS;
  if (input.lessonsTaken >= grace) return { step: 'HOLD', why: 'GRACE_USED' };
  if (input.cycleEnded) return { step: 'HOLD', why: 'CYCLE_ENDED' };
  return {
    step: 'GRACE',
    taken: input.lessonsTaken,
    left: grace - input.lessonsTaken,
  };
}

/**
 * Does this lesson use up one of the lessons of grace? Held lessons and
 * cancelled ones that still count do; a makeup (owed from before) does not.
 */
export function countsAsTaken(
  l: {
    status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'RESCHEDULED';
    startsAt: Date;
    durationMin: number;
    countedAsTaken: boolean;
    extraReason?: 'MAKEUP' | 'OTHER' | null;
  },
  now: Date,
): boolean {
  if (l.extraReason === 'MAKEUP') return false;
  if (l.status === 'COMPLETED') return true;
  if (l.status === 'CANCELLED') return l.countedAsTaken;
  if (l.status === 'SCHEDULED')
    return l.startsAt.getTime() + l.durationMin * 60_000 <= now.getTime();
  return false;
}
