import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Query,
} from '@nestjs/common';
import { IsISO8601, Matches } from 'class-validator';
import { ApiTags } from '@nestjs/swagger';
import {
  and,
  count,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
  sum,
} from 'drizzle-orm';
import {
  Area,
  type AuthUser,
  CurrentUser,
  Roles,
} from '../common/auth-user.js';
import { DB, type Db } from '../db/db.module.js';
import {
  billingCycles,
  changeRequests,
  invoices,
  lessons,
  students,
  subscriptions,
  teacherPayouts,
  teachers,
} from '../db/schema.js';
import { ACADEMY_TZ, dayBounds, localDateOf } from '../rules/schedule.js';
import { teacherRate } from '../teachers/pay-rate.js';
import { monthBounds, monthlyReport } from './monthly-report.js';
import { held, payFor, teacherLessonRows } from './teacher-lessons.js';

const DAY = 86_400_000;

class RangeQuery {
  /** first day, YYYY-MM-DD (Cairo) */
  @IsISO8601({ strict: true }) from: string;
  /** last day, included, YYYY-MM-DD (Cairo) */
  @IsISO8601({ strict: true }) to: string;
}

class MonthQuery {
  /** YYYY-MM (Cairo) */
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'month must look like 2026-10',
  })
  month: string;
}

/** The academy at a glance, for the admin's Today page. */
@ApiTags('Stats')
@Controller('stats')
export class StatsController {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * One month in numbers: money issued and collected, what happened to the
   * lessons, students; teacher pay for admins only.
   */
  @Get('monthly')
  @Roles('ADMIN', 'STAFF')
  @Area('billing')
  monthly(@CurrentUser() user: AuthUser, @Query() q: MonthQuery) {
    return monthlyReport(this.db, q.month, user.role === 'ADMIN');
  }

  /**
   * A teacher's own month: lessons that count for them, hours, and the ones
   * that don't or are still to check, and what that comes to at their rate.
   */
  @Get('my-month')
  @Roles('TEACHER')
  async myMonth(@CurrentUser() user: AuthUser, @Query() q: MonthQuery) {
    const { from, to } = monthBounds(q.month);
    const [row] = await teacherLessonRows(this.db, from, to, user.teacherId!);
    const rate = await teacherRate(this.db, user.teacherId!);
    const [paid] = await this.db
      .select({
        amountCents: teacherPayouts.amountCents,
        currency: teacherPayouts.currency,
        paidAt: teacherPayouts.paidAt,
      })
      .from(teacherPayouts)
      .where(
        and(
          eq(teacherPayouts.teacherId, user.teacherId!),
          eq(teacherPayouts.month, q.month),
        ),
      );
    return {
      month: q.month,
      /** the teacher's own pay per hour (their rate, or their level's) */
      rateCents: rate?.rateCents ?? null,
      currency: rate?.currency ?? 'EGP',
      /** hours that count x rate; lessons still to check are not in it yet */
      expectedPayCents: payFor(row?.paidMinutes ?? 0, rate?.rateCents ?? null),
      /** what the academy recorded as paid for this month, if it has */
      paid: paid ?? null,
      held: row?.held ?? 0,
      studentAbsent: row?.studentAbsent ?? 0,
      /** held, or the student was absent: these count for the teacher */
      counted: row?.paid ?? 0,
      minutes: row?.paidMinutes ?? 0,
      notCounted: row?.notPaid ?? 0,
      toCheck: row?.toCheck ?? 0,
    };
  }

  @Get('overview')
  @Roles('ADMIN', 'STAFF')
  async overview() {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * DAY);
    const weekAhead = new Date(now.getTime() + 7 * DAY);
    const today = localDateOf(now, ACADEMY_TZ);

    const [activeStudents] = await this.db
      .select({ n: count(sql`distinct ${subscriptions.studentId}`) })
      .from(subscriptions)
      .innerJoin(students, eq(students.id, subscriptions.studentId))
      .where(
        and(eq(subscriptions.status, 'ACTIVE'), eq(students.status, 'ACTIVE')),
      );
    const [activeTeachers] = await this.db
      .select({ n: count() })
      .from(teachers)
      .where(eq(teachers.status, 'ACTIVE'));

    const [onHold] = await this.db
      .select({ n: count() })
      .from(subscriptions)
      .where(isNotNull(subscriptions.heldForInvoiceId));
    const unpaid = await this.db
      .select({
        currency: invoices.currency,
        n: count(),
        total: sum(invoices.totalCents),
      })
      .from(invoices)
      .where(eq(invoices.status, 'OPEN'))
      .groupBy(invoices.currency);
    // Prepaid: an open invoice whose cycle has already started is overdue.
    const [overdue] = await this.db
      .select({ n: count() })
      .from(invoices)
      .innerJoin(billingCycles, eq(billingCycles.id, invoices.cycleId))
      .where(
        and(
          eq(invoices.status, 'OPEN'),
          lt(billingCycles.startDate, sql`${today}::date`),
        ),
      );

    const [nextWeek] = await this.db
      .select({ n: count() })
      .from(lessons)
      .where(
        and(
          eq(lessons.status, 'SCHEDULED'),
          gte(lessons.startsAt, now),
          lt(lessons.startsAt, weekAhead),
        ),
      );
    const pastWeek = and(
      gte(lessons.startsAt, weekAgo),
      lt(lessons.startsAt, now),
    );
    const [missingNotes] = await this.db
      .select({ n: count() })
      .from(lessons)
      .where(
        and(pastWeek, held, or(isNull(lessons.notes), eq(lessons.notes, ''))),
      );
    const [toCheck] = await this.db
      .select({ n: count() })
      .from(lessons)
      .where(
        and(
          isNotNull(lessons.closedAt),
          isNull(lessons.reviewedAt),
          ne(lessons.attendance, 'BOTH'),
          inArray(lessons.status, ['SCHEDULED', 'COMPLETED']),
        ),
      );
    const [cancelledWeek] = await this.db
      .select({ n: count() })
      .from(lessons)
      .where(and(pastWeek, eq(lessons.status, 'CANCELLED')));
    const [makeups] = await this.db
      .select({ n: count() })
      .from(lessons)
      .where(eq(lessons.makeupOwed, true));
    const [openRequests] = await this.db
      .select({ n: count() })
      .from(changeRequests)
      .where(eq(changeRequests.status, 'OPEN'));

    return {
      activeStudents: activeStudents?.n ?? 0,
      activeTeachers: activeTeachers?.n ?? 0,
      unpaid: unpaid.map((u) => ({
        currency: u.currency,
        invoices: u.n,
        totalCents: Number(u.total ?? 0),
      })),
      overdueInvoices: overdue?.n ?? 0,
      /** students whose lessons are stopped until they pay */
      subscriptionsOnHold: onHold?.n ?? 0,
      lessonsNext7Days: nextWeek?.n ?? 0,
      /** held in the last 7 days, no notes yet */
      missingNotesLast7Days: missingNotes?.n ?? 0,
      /** finished lessons someone did not enter, not checked yet (any age) */
      attendanceToCheck: toCheck?.n ?? 0,
      /** teacher cancels with a makeup chosen, not booked yet */
      makeupsOwed: makeups?.n ?? 0,
      cancelledLast7Days: cancelledWeek?.n ?? 0,
      openRequests: openRequests?.n ?? 0,
    };
  }

  /**
   * Lessons per teacher between two days (Cairo), for paying teachers.
   * Paid: held, or the teacher was there and the student was not.
   * Not paid: the teacher did not come, or nobody came.
   * To check: the teacher did not enter and staff have not decided yet.
   */
  @Get('teacher-lessons')
  @Roles('ADMIN', 'STAFF')
  async teacherLessons(@CurrentUser() user: AuthUser, @Query() q: RangeQuery) {
    if (q.to < q.from)
      throw new BadRequestException('The last day is before the first day.');
    if ((Date.parse(q.to) - Date.parse(q.from)) / DAY > 366)
      throw new BadRequestException('At most one year at a time.');
    const rows = await teacherLessonRows(
      this.db,
      dayBounds(q.from, ACADEMY_TZ).from,
      dayBounds(q.to, ACADEMY_TZ).to,
    );
    const admin = user.role === 'ADMIN';
    return rows.map(({ rateCents, currency, ...r }) =>
      admin
        ? {
            ...r,
            /** pay per hour; null = not set on the teacher yet */
            rateCents,
            currency,
            /** paid hours x rate; null without a rate */
            payCents: payFor(r.paidMinutes, rateCents),
          }
        : r,
    );
  }
}
