import { and, asc, eq, gte, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import type { Db } from '../db/db.module.js';
import { lessons, levelPayRates, teachers, users } from '../db/schema.js';
import {
  levelRateJoin,
  rateCentsSql,
  rateCurrencySql,
} from '../teachers/pay-rate.js';

/** Held with both there (or both pressed before the lesson was settled). */
export const held = and(
  eq(lessons.status, 'COMPLETED'),
  or(isNull(lessons.attendance), eq(lessons.attendance, 'BOTH')),
);

export interface TeacherLessonsRow {
  teacherId: string;
  name: string;
  rateCents: number | null;
  currency: string;
  held: number;
  studentAbsent: number;
  /** held, or the teacher was there and the student was not */
  paid: number;
  paidMinutes: number;
  /** the teacher did not come, or nobody came */
  notPaid: number;
  /** the teacher did not enter and staff have not decided yet */
  toCheck: number;
}

/**
 * Lessons per teacher that started in [from, to), counted for pay.
 * Teachers with nothing to count are left out.
 */
export async function teacherLessonRows(
  db: Db,
  from: Date,
  to: Date,
  teacherId?: string,
): Promise<TeacherLessonsRow[]> {
  const n = (cond: ReturnType<typeof and>) =>
    sql<number>`count(*) filter (where ${cond})::int`;
  const minutes = (cond: ReturnType<typeof and>) =>
    sql<number>`coalesce(sum(${lessons.durationMin}) filter (where ${cond}), 0)::int`;
  const studentAbsent = and(
    eq(lessons.status, 'COMPLETED'),
    eq(lessons.attendance, 'TEACHER_ONLY'),
  );
  const paid = or(held, studentAbsent);
  const notPaid = or(
    and(eq(lessons.status, 'COMPLETED'), eq(lessons.attendance, 'NONE')),
    // "teacher did not come", recorded by staff after the lesson
    and(
      eq(lessons.status, 'CANCELLED'),
      eq(lessons.cancelReason, 'BY_TEACHER'),
      isNotNull(lessons.closedAt),
    ),
  );
  const waiting = and(
    eq(lessons.status, 'SCHEDULED'),
    isNotNull(lessons.closedAt),
  );
  const rows = await db
    .select({
      teacherId: teachers.id,
      name: users.fullName,
      rateCents: rateCentsSql,
      currency: rateCurrencySql,
      held: n(held),
      studentAbsent: n(studentAbsent),
      paid: n(paid),
      paidMinutes: minutes(paid),
      notPaid: n(notPaid),
      toCheck: n(waiting),
    })
    .from(lessons)
    .innerJoin(teachers, eq(teachers.id, lessons.teacherId))
    .innerJoin(users, eq(users.id, teachers.userId))
    .leftJoin(levelPayRates, levelRateJoin)
    .where(
      and(
        gte(lessons.startsAt, from),
        lt(lessons.startsAt, to),
        teacherId ? eq(lessons.teacherId, teacherId) : undefined,
      ),
    )
    .groupBy(
      teachers.id,
      users.fullName,
      teachers.hourlyRateCents,
      teachers.rateCurrency,
      levelPayRates.hourlyRateCents,
      levelPayRates.currency,
    )
    .orderBy(asc(users.fullName));
  return rows.filter((r) => r.paid || r.notPaid || r.toCheck);
}

/** Paid hours × the hourly rate, in cents; null without a rate. */
export function payFor(
  paidMinutes: number,
  rateCents: number | null,
): number | null {
  return rateCents === null ? null : Math.round((paidMinutes / 60) * rateCents);
}
