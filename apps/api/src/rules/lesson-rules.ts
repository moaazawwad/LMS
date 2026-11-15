/**
 * Business rules for lessons, kept as plain functions so they are easy to test
 * and the same logic serves the admin, teacher and student dashboards.
 */
import type { CancelReason, LessonStatus, Tier } from '../db/schema.js';

/** Students can cancel or reschedule on their own up to this many hours before a lesson. */
export const SELF_SERVICE_NOTICE_HOURS = 4;

/**
 * "Enter class" opens this many minutes before the start.
 * Open decision in the decisions doc; 10 is the working assumption.
 */
export const ENTER_CLASS_OPENS_MIN_BEFORE = 10;

export type ChangeAction = 'cancel' | 'reschedule';

/**
 * Lessons a teacher may cancel in a month (Cairo calendar month of the
 * lesson). Lessons they did not come to count too. Beyond it only an admin
 * override with a note.
 */
export const TEACHER_CANCELS_PER_MONTH = 4;

export function teacherCancelCheck(
  used: number,
  month: string,
  limit = TEACHER_CANCELS_PER_MONTH,
): RuleViolation[] {
  return used >= limit
    ? [
        {
          code: 'TEACHER_CANCEL_LIMIT',
          message: `All ${limit} teacher cancellations for ${month} are used.`,
        },
      ]
    : [];
}

export type RuleCode =
  | 'LESSON_NOT_SCHEDULED'
  | 'LESSON_STARTED'
  | 'NOTICE_TOO_SHORT'
  | 'QUOTA_EXHAUSTED'
  | 'TEACHER_LEVEL_TOO_LOW'
  | 'CURRICULUM_NOT_TAUGHT'
  | 'TEACHER_UNAVAILABLE'
  | 'TIME_CONFLICT'
  | 'NEW_TIME_TOO_SOON'
  | 'TEACHER_CANCEL_LIMIT'
  | 'PAY_MONTH_NOT_OVER'
  | 'PAY_LESSONS_TO_CHECK';

export interface RuleViolation {
  code: RuleCode;
  message: string;
  /** Which lesson it is about, e.g. "Fri, Oct 23 · 3:00 AM Cairo", when one action touches many lessons. */
  at?: string;
}

/** quota = null means unlimited (Premium). */
export interface QuotaState {
  quota: number | null;
  used: number;
}

export interface ChangeCheck {
  allowed: boolean;
  violations: RuleViolation[];
}

const HOUR_MS = 3_600_000;

export function hoursUntil(startsAt: Date, now: Date): number {
  return (startsAt.getTime() - now.getTime()) / HOUR_MS;
}

export function quotaLeft(q: QuotaState): number | null {
  return q.quota === null ? null : Math.max(0, q.quota - q.used);
}

/**
 * Can the STUDENT cancel or reschedule this lesson by themselves?
 * Rule: at least 4 hours before the start, and quota left for that action.
 * Applies to every plan, Premium included (Premium just has no quota limit).
 */
export function checkStudentChange(input: {
  action: ChangeAction;
  lessonStatus: LessonStatus;
  startsAt: Date;
  now: Date;
  quota: QuotaState;
}): ChangeCheck {
  const violations: RuleViolation[] = [];
  const what = input.action === 'cancel' ? 'cancellations' : 'reschedules';

  if (input.lessonStatus !== 'SCHEDULED') {
    violations.push({
      code: 'LESSON_NOT_SCHEDULED',
      message: 'Only scheduled lessons can be changed.',
    });
  }
  if (input.startsAt.getTime() <= input.now.getTime()) {
    violations.push({
      code: 'LESSON_STARTED',
      message: 'The lesson has already started.',
    });
  } else if (
    hoursUntil(input.startsAt, input.now) < SELF_SERVICE_NOTICE_HOURS
  ) {
    violations.push({
      code: 'NOTICE_TOO_SHORT',
      message: `Less than ${SELF_SERVICE_NOTICE_HOURS} hours before the lesson. Contact the academy.`,
    });
  }
  if (input.quota.quota !== null && input.quota.used >= input.quota.quota) {
    violations.push({
      code: 'QUOTA_EXHAUSTED',
      message: `No ${what} left this cycle (${input.quota.used} of ${input.quota.quota} used).`,
    });
  }
  return { allowed: violations.length === 0, violations };
}

export interface CancelOutcome {
  /** add a credit to the next invoice */
  credit: boolean;
  /** count it against the student's cancel quota */
  usesQuota: boolean;
  /** billed as if the lesson happened */
  countedAsTaken: boolean;
  /** the academy owes the student a makeup lesson */
  makeup: boolean;
}

export type TeacherRemedy = 'MAKEUP' | 'CREDIT';

/**
 * What a cancellation means for billing and quota.
 * - student, within the rules: credit on next invoice, uses one cancel
 * - student, late or out of quota (only the admin can record it): counted as taken
 * - teacher: makeup lesson or credit, never touches the student's quota
 * - admin: credit, no quota
 * - unpaid invoice: no credit, nothing counted
 */
export function cancellationOutcome(input: {
  reason: CancelReason;
  withinRules: boolean;
  teacherRemedy?: TeacherRemedy;
}): CancelOutcome {
  switch (input.reason) {
    case 'BY_STUDENT':
      return input.withinRules
        ? {
            credit: true,
            usesQuota: true,
            countedAsTaken: false,
            makeup: false,
          }
        : {
            credit: false,
            usesQuota: false,
            countedAsTaken: true,
            makeup: false,
          };
    case 'BY_TEACHER':
      return input.teacherRemedy === 'MAKEUP'
        ? {
            credit: false,
            usesQuota: false,
            countedAsTaken: false,
            makeup: true,
          }
        : {
            credit: true,
            usesQuota: false,
            countedAsTaken: false,
            makeup: false,
          };
    case 'BY_ADMIN':
      return {
        credit: true,
        usesQuota: false,
        countedAsTaken: false,
        makeup: false,
      };
    case 'UNPAID':
      return {
        credit: false,
        usesQuota: false,
        countedAsTaken: false,
        makeup: false,
      };
  }
}

const TIER_RANK: Record<Tier, number> = { BASIC: 1, STANDARD: 2, PREMIUM: 3 };

/**
 * A plan needs a teacher of its level. A higher-level teacher is allowed when
 * none of the plan's level is free; a lower-level one needs an admin override.
 */
export function teacherLevelCheck(
  teacherLevel: Tier,
  planTier: Tier,
): 'MATCH' | 'HIGHER' | 'LOWER' {
  const diff = TIER_RANK[teacherLevel] - TIER_RANK[planTier];
  return diff === 0 ? 'MATCH' : diff > 0 ? 'HIGHER' : 'LOWER';
}

export function canEnterClass(
  startsAt: Date,
  durationMin: number,
  now: Date,
): boolean {
  const opens = startsAt.getTime() - ENTER_CLASS_OPENS_MIN_BEFORE * 60_000;
  const ends = startsAt.getTime() + durationMin * 60_000;
  return now.getTime() >= opens && now.getTime() <= ends;
}

/** Attendance comes from "Enter class": both pressed = completed. */
export function statusAfterJoin(
  current: LessonStatus,
  teacherJoinedAt: Date | null,
  studentJoinedAt: Date | null,
): LessonStatus {
  if (current !== 'SCHEDULED') return current;
  return teacherJoinedAt && studentJoinedAt ? 'COMPLETED' : 'SCHEDULED';
}

// ---------------------------------------------------------------- after the lesson

export type Attendance = 'BOTH' | 'TEACHER_ONLY' | 'STUDENT_ONLY' | 'NONE';

/** A lesson is settled this many minutes after it ends. */
export const CLOSE_AFTER_END_MIN = 5;

export function attendanceOf(
  teacherJoinedAt: Date | null,
  studentJoinedAt: Date | null,
): Attendance {
  if (teacherJoinedAt && studentJoinedAt) return 'BOTH';
  if (teacherJoinedAt) return 'TEACHER_ONLY';
  if (studentJoinedAt) return 'STUDENT_ONLY';
  return 'NONE';
}

/**
 * What happens when a finished lesson is settled.
 * - both entered: held.
 * - only the teacher: the student was absent; it counts as taken and the teacher is paid.
 *   Staff get a notice.
 * - the teacher did not enter: not paid; the lesson waits for staff to decide what happened.
 */
export function closeOutcome(attendance: Attendance): {
  status: 'COMPLETED' | 'SCHEDULED';
  needsReview: boolean;
} {
  switch (attendance) {
    case 'BOTH':
      return { status: 'COMPLETED', needsReview: false };
    case 'TEACHER_ONLY':
      return { status: 'COMPLETED', needsReview: true };
    default:
      return { status: 'SCHEDULED', needsReview: true };
  }
}

/** What staff decide when they look at a lesson that was not attended by both. */
export type ReviewOutcome =
  /** student absent, as recorded: fine */
  | 'CONFIRM'
  /** the lesson happened; someone forgot to press Enter class */
  | 'HELD'
  /** the teacher was there, the student was not: counted, teacher paid */
  | 'STUDENT_ABSENT'
  /** nobody came: counted for the student, teacher not paid */
  | 'NOBODY_CAME'
  /** the teacher did not come: cancelled by the teacher, student gets a makeup or a credit */
  | 'TEACHER_ABSENT';

const ALLOWED: Record<Attendance, ReviewOutcome[]> = {
  BOTH: [],
  TEACHER_ONLY: ['CONFIRM', 'HELD'],
  STUDENT_ONLY: ['HELD', 'TEACHER_ABSENT'],
  NONE: ['HELD', 'STUDENT_ABSENT', 'NOBODY_CAME', 'TEACHER_ABSENT'],
};

export function reviewOptions(attendance: Attendance | null): ReviewOutcome[] {
  return attendance ? ALLOWED[attendance] : [];
}

/** The lesson after a review (TEACHER_ABSENT is a cancel, handled by the cancel rules). */
export function reviewResult(
  outcome: Exclude<ReviewOutcome, 'TEACHER_ABSENT'>,
  current: Attendance,
): { status: 'COMPLETED'; attendance: Attendance } {
  switch (outcome) {
    case 'CONFIRM':
      return { status: 'COMPLETED', attendance: current };
    case 'HELD':
      return { status: 'COMPLETED', attendance: 'BOTH' };
    case 'STUDENT_ABSENT':
      return { status: 'COMPLETED', attendance: 'TEACHER_ONLY' };
    case 'NOBODY_CAME':
      return { status: 'COMPLETED', attendance: 'NONE' };
  }
}

/**
 * Is the teacher paid for this lesson? null = not decided yet.
 * Paid when the lesson was held or the student was absent; not paid when the
 * teacher did not come or nobody came, or the lesson was cancelled.
 */
export function teacherPaid(l: {
  status: LessonStatus;
  attendance: Attendance | null;
  closedAt: Date | null;
}): boolean | null {
  if (l.status === 'CANCELLED' || l.status === 'RESCHEDULED') return false;
  if (l.status === 'COMPLETED')
    return (
      l.attendance === null ||
      l.attendance === 'BOTH' ||
      l.attendance === 'TEACHER_ONLY'
    );
  return l.closedAt ? false : null;
}

/** Settled, not attended by both, and no staff member has looked yet. */
export function needsReview(l: {
  status: LessonStatus;
  attendance: Attendance | null;
  closedAt: Date | null;
  reviewedAt: Date | null;
}): boolean {
  if (
    !l.closedAt ||
    l.reviewedAt ||
    l.attendance === 'BOTH' ||
    l.attendance === null
  )
    return false;
  return l.status === 'SCHEDULED' || l.status === 'COMPLETED';
}
