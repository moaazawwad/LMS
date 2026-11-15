import { and, eq, gte, isNotNull, lt, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { Db } from '../db/db.module.js';
import {
  invoices,
  lessons,
  students,
  subscriptions,
  teacherPayouts,
} from '../db/schema.js';
import { ACADEMY_TZ } from '../rules/schedule.js';
import { held, payFor, teacherLessonRows } from './teacher-lessons.js';

export interface Money {
  currency: string;
  count: number;
  cents: number;
}

/** Start and end (exclusive) of a Cairo month, plus its first and last day. */
export function monthBounds(month: string) {
  const start = DateTime.fromISO(`${month}-01`, { zone: ACADEMY_TZ }).startOf(
    'month',
  );
  const end = start.plus({ months: 1 });
  return {
    from: start.toJSDate(),
    to: end.toJSDate(),
    firstDay: start.toISODate()!,
    lastDay: end.minus({ days: 1 }).toISODate()!,
  };
}

const n = (cond: ReturnType<typeof and>) =>
  sql<number>`count(*) filter (where ${cond})::int`;

/** Sums per currency, biggest first. */
function byCurrency(
  rows: { currency: string; count: number; cents: number | string | null }[],
): Money[] {
  return rows
    .map((r) => ({
      currency: r.currency,
      count: Number(r.count),
      cents: Number(r.cents ?? 0),
    }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.cents - a.cents);
}

/**
 * One month of the academy (Cairo time): money in and out, what happened to
 * the lessons, students, and (admins only) teacher pay. Plus the six months
 * up to it, for the trend.
 */
export async function monthlyReport(
  db: Db,
  month: string,
  withPay: boolean,
  now = new Date(),
) {
  const { from, to, firstDay, lastDay } = monthBounds(month);
  const issuedIn = and(gte(invoices.issuedAt, from), lt(invoices.issuedAt, to));
  const paidIn = and(gte(invoices.paidAt, from), lt(invoices.paidAt, to));

  const moneyRows = async (where: ReturnType<typeof and>) =>
    byCurrency(
      await db
        .select({
          currency: invoices.currency,
          count: sql<number>`count(*)::int`,
          cents: sql<number>`coalesce(sum(${invoices.totalCents}), 0)::bigint`,
        })
        .from(invoices)
        .where(where)
        .groupBy(invoices.currency),
    );
  const [issued, collected, dueNow] = await Promise.all([
    moneyRows(and(issuedIn, sql`${invoices.status} <> 'VOID'`)),
    moneyRows(and(paidIn, eq(invoices.status, 'PAID'))),
    moneyRows(eq(invoices.status, 'OPEN')),
  ]);
  const [voided] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(invoices)
    .where(and(gte(invoices.voidedAt, from), lt(invoices.voidedAt, to)));

  const inMonth = and(gte(lessons.startsAt, from), lt(lessons.startsAt, to));
  const cancelled = (
    reason: 'BY_STUDENT' | 'BY_TEACHER' | 'BY_ADMIN' | 'UNPAID',
  ) => and(eq(lessons.status, 'CANCELLED'), eq(lessons.cancelReason, reason));
  const [l] = await db
    .select({
      held: n(held),
      studentAbsent: n(
        and(
          eq(lessons.status, 'COMPLETED'),
          eq(lessons.attendance, 'TEACHER_ONLY'),
        ),
      ),
      nobodyCame: n(
        and(eq(lessons.status, 'COMPLETED'), eq(lessons.attendance, 'NONE')),
      ),
      toCheck: n(
        and(eq(lessons.status, 'SCHEDULED'), isNotNull(lessons.closedAt)),
      ),
      upcoming: n(
        and(eq(lessons.status, 'SCHEDULED'), sql`${lessons.closedAt} is null`),
      ),
      byStudent: n(cancelled('BY_STUDENT')),
      byTeacher: n(cancelled('BY_TEACHER')),
      byAcademy: n(cancelled('BY_ADMIN')),
      unpaid: n(cancelled('UNPAID')),
      moved: n(eq(lessons.status, 'RESCHEDULED')),
      extra: n(
        and(
          eq(lessons.extraReason, 'OTHER'),
          sql`${lessons.status} <> 'RESCHEDULED'`,
        ),
      ),
      makeup: n(
        and(
          eq(lessons.extraReason, 'MAKEUP'),
          sql`${lessons.status} <> 'RESCHEDULED'`,
        ),
      ),
    })
    .from(lessons)
    .where(inMonth);

  const [s] = await db
    .select({
      active: sql<number>`count(*) filter (where ${students.status} = 'ACTIVE')::int`,
    })
    .from(students);
  const [started] = await db
    .select({ n: sql<number>`count(distinct ${subscriptions.studentId})::int` })
    .from(subscriptions)
    .where(
      and(
        gte(subscriptions.startDate, firstDay),
        sql`${subscriptions.startDate} <= ${lastDay}::date`,
      ),
    );

  let pay: {
    owed: Money[];
    recorded: Money[];
    teachersPaid: number;
    teachers: number;
  } | null = null;
  if (withPay) {
    const rows = await teacherLessonRows(db, from, to);
    const owed = new Map<string, Money>();
    for (const r of rows) {
      const cents = payFor(r.paidMinutes, r.rateCents);
      if (cents === null || r.paid === 0) continue;
      const m = owed.get(r.currency) ?? {
        currency: r.currency,
        count: 0,
        cents: 0,
      };
      m.count++;
      m.cents += cents;
      owed.set(r.currency, m);
    }
    const recorded = byCurrency(
      await db
        .select({
          currency: teacherPayouts.currency,
          count: sql<number>`count(*)::int`,
          cents: sql<number>`coalesce(sum(${teacherPayouts.amountCents}), 0)::bigint`,
        })
        .from(teacherPayouts)
        .where(eq(teacherPayouts.month, month))
        .groupBy(teacherPayouts.currency),
    );
    pay = {
      owed: [...owed.values()].sort((a, b) => b.cents - a.cents),
      recorded,
      teachersPaid: recorded.reduce((t, r) => t + r.count, 0),
      teachers: rows.filter((r) => r.paid > 0).length,
    };
  }

  // The six months up to this one: money collected and lessons held.
  const first = monthBounds(
    DateTime.fromISO(`${month}-01`).minus({ months: 5 }).toFormat('yyyy-MM'),
  ).from;
  const monthOf = (col: typeof invoices.paidAt | typeof lessons.startsAt) =>
    sql<string>`to_char(${col} at time zone ${sql.raw(`'${ACADEMY_TZ}'`)}, 'YYYY-MM')`;
  const paidTrend = await db
    .select({
      month: monthOf(invoices.paidAt),
      currency: invoices.currency,
      cents: sql<number>`coalesce(sum(${invoices.totalCents}), 0)::bigint`,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.status, 'PAID'),
        gte(invoices.paidAt, first),
        lt(invoices.paidAt, to),
      ),
    )
    .groupBy(monthOf(invoices.paidAt), invoices.currency);
  const heldTrend = await db
    .select({ month: monthOf(lessons.startsAt), held: n(held) })
    .from(lessons)
    .where(and(gte(lessons.startsAt, first), lt(lessons.startsAt, to)))
    .groupBy(monthOf(lessons.startsAt));
  const months = Array.from({ length: 6 }, (_, i) =>
    DateTime.fromISO(`${month}-01`)
      .minus({ months: 5 - i })
      .toFormat('yyyy-MM'),
  );
  const trend = months.map((m) => ({
    month: m,
    collected: paidTrend
      .filter((r) => r.month === m)
      .map((r) => ({ currency: r.currency, cents: Number(r.cents) }))
      .sort((a, b) => b.cents - a.cents),
    held: heldTrend.find((r) => r.month === m)?.held ?? 0,
  }));

  return {
    month,
    firstDay,
    lastDay,
    /** the month is not over yet (Cairo) */
    inProgress: now.getTime() < to.getTime(),
    money: { issued, collected, dueNow, voided: voided?.n ?? 0 },
    lessons: l,
    students: { active: s?.active ?? 0, started: started?.n ?? 0 },
    teacherPay: pay,
    trend,
  };
}
