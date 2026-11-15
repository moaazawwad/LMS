import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Query,
  Res,
} from '@nestjs/common';
import { ApiProduces, ApiTags } from '@nestjs/swagger';
import { IsISO8601, Matches } from 'class-validator';
import { and, asc, eq, gte, lt } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Response } from 'express';
import { AuditService } from '../audit/audit.service.js';
import {
  Area,
  type AuthUser,
  CurrentUser,
  Roles,
} from '../common/auth-user.js';
import { DB, type Db } from '../db/db.module.js';
import {
  billingCycles,
  curricula,
  invoices,
  lessons,
  students,
  subscriptions,
  teachers,
  users,
} from '../db/schema.js';
import { ACADEMY_TZ, dayBounds, formatInZone } from '../rules/schedule.js';
import { teacherPaid } from '../rules/lesson-rules.js';
import { type Money, monthlyReport } from '../stats/monthly-report.js';
import { type Cell, toCsv } from './csv.js';

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

const ATTENDANCE: Record<string, string> = {
  BOTH: 'both entered',
  TEACHER_ONLY: 'student absent',
  STUDENT_ONLY: 'teacher did not enter',
  NONE: 'nobody entered',
};
const cents = (n: number) => (n / 100).toFixed(2);
const cairo = (d: Date | null) =>
  d ? formatInZone(d, ACADEMY_TZ, 'yyyy-MM-dd HH:mm') : '';

/** CSV downloads for accounting and reports. Every download is logged. */
@ApiTags('Exports')
@Controller('exports')
@Roles('ADMIN', 'STAFF')
@Area('billing')
export class ExportsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /** Invoices issued between two days (Cairo), oldest first. */
  @Get('invoices.csv')
  @ApiProduces('text/csv')
  async invoices(
    @CurrentUser() user: AuthUser,
    @Query() q: RangeQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { from, to } = this.range(q);
    const rows = await this.db
      .select({
        i: invoices,
        cycle: billingCycles,
        name: users.fullName,
        email: users.email,
      })
      .from(invoices)
      .innerJoin(billingCycles, eq(billingCycles.id, invoices.cycleId))
      .innerJoin(students, eq(students.id, invoices.studentId))
      .innerJoin(users, eq(users.id, students.userId))
      .where(and(gte(invoices.issuedAt, from), lt(invoices.issuedAt, to)))
      .orderBy(asc(invoices.issuedAt));
    await this.log(user, 'invoices', q, rows.length);
    return this.send(
      res,
      `invoices_${q.from}_${q.to}.csv`,
      toCsv(
        [
          'Invoice',
          'Status',
          'Student',
          'Email',
          'Cycle',
          'Cycle start',
          'Cycle end',
          'Lessons',
          'Extra lessons',
          'Credits',
          'Billed lessons',
          'Price per lesson',
          'Total',
          'Currency',
          'Issued (Cairo)',
          'Paid (Cairo)',
          'Voided (Cairo)',
          'Void reason',
        ],
        rows.map(({ i, cycle, name, email }) => [
          i.number,
          i.status,
          name,
          email,
          cycle.index,
          cycle.startDate,
          cycle.endDate,
          i.lessonsCount,
          i.extraCount,
          i.creditsCount,
          i.billedLessons,
          cents(i.priceCents),
          cents(i.totalCents),
          i.currency,
          cairo(i.issuedAt),
          cairo(i.paidAt),
          cairo(i.voidedAt),
          i.voidReason ?? '',
        ]),
      ),
    );
  }

  /** The monthly report as rows: section, item, number, amount, currency. Teacher pay for admins only. */
  @Get('month.csv')
  @ApiProduces('text/csv')
  async month(
    @CurrentUser() user: AuthUser,
    @Query() q: MonthQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await monthlyReport(this.db, q.month, user.role === 'ADMIN');
    const rows: Cell[][] = [];
    const money = (section: string, item: string, lines: Money[]) => {
      if (!lines.length) rows.push([section, item, 0, '0.00', '']);
      for (const m of lines)
        rows.push([section, item, m.count, cents(m.cents), m.currency]);
    };
    money('Money', 'Invoiced', r.money.issued);
    money('Money', 'Collected', r.money.collected);
    money('Money', 'Due now', r.money.dueNow);
    rows.push(['Money', 'Voided invoices', r.money.voided, '', '']);
    const l = r.lessons;
    for (const [item, n] of [
      ['Held', l.held],
      ['Student absent', l.studentAbsent],
      ['Nobody came', l.nobodyCame],
      ['Cancelled by students', l.byStudent],
      ['Cancelled by teachers', l.byTeacher],
      ['Cancelled by the academy', l.byAcademy],
      ['Cancelled, unpaid', l.unpaid],
      ['Moved', l.moved],
      ['Extra (billed)', l.extra],
      ['Makeup', l.makeup],
      ['To check', l.toCheck],
      ['Still to come', l.upcoming],
    ] as const)
      rows.push(['Lessons', item, n, '', '']);
    rows.push(['Students', 'Active now', r.students.active, '', '']);
    rows.push(['Students', 'Started this month', r.students.started, '', '']);
    if (r.teacherPay) {
      money('Teacher pay', 'Earned', r.teacherPay.owed);
      money('Teacher pay', 'Recorded as paid', r.teacherPay.recorded);
    }
    await this.audit.record(this.db, user, {
      action: 'export.month',
      entityType: 'export',
      entityId: 'month',
      summary: `Downloaded the ${q.month} report as CSV`,
    });
    return this.send(
      res,
      `report_${q.month}.csv`,
      toCsv(['Section', 'Item', 'Number', 'Amount', 'Currency'], rows),
    );
  }

  /** Lessons between two days (Cairo), in time order, with attendance and outcome. */
  @Get('lessons.csv')
  @ApiProduces('text/csv')
  async lessons(
    @CurrentUser() user: AuthUser,
    @Query() q: RangeQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { from, to } = this.range(q);
    const studentUser = alias(users, 'student_user');
    const teacherUser = alias(users, 'teacher_user');
    const rows = await this.db
      .select({
        l: lessons,
        student: studentUser.fullName,
        studentTz: studentUser.timezone,
        subTz: subscriptions.timezone,
        teacher: teacherUser.fullName,
        curriculum: curricula.name,
      })
      .from(lessons)
      .innerJoin(students, eq(students.id, lessons.studentId))
      .innerJoin(studentUser, eq(studentUser.id, students.userId))
      .innerJoin(teachers, eq(teachers.id, lessons.teacherId))
      .innerJoin(teacherUser, eq(teacherUser.id, teachers.userId))
      .innerJoin(curricula, eq(curricula.id, lessons.curriculumId))
      .leftJoin(subscriptions, eq(subscriptions.id, lessons.subscriptionId))
      .where(and(gte(lessons.startsAt, from), lt(lessons.startsAt, to)))
      .orderBy(asc(lessons.startsAt));
    await this.log(user, 'lessons', q, rows.length);
    return this.send(
      res,
      `lessons_${q.from}_${q.to}.csv`,
      toCsv(
        [
          'Starts (Cairo)',
          'Starts (student)',
          'Student time zone',
          'Student',
          'Teacher',
          'Curriculum',
          'Minutes',
          'Type',
          'Status',
          'Cancelled by',
          'Counted as taken',
          'Teacher entered (Cairo)',
          'Student entered (Cairo)',
          'Attendance',
          'Teacher paid',
          'Notes written',
          'Homework',
        ],
        rows.map(({ l, student, studentTz, subTz, teacher, curriculum }) => {
          const tz = subTz ?? studentTz;
          return [
            cairo(l.startsAt),
            formatInZone(l.startsAt, tz, 'yyyy-MM-dd HH:mm'),
            tz,
            student,
            teacher,
            curriculum,
            l.durationMin,
            l.type,
            l.status,
            l.cancelReason ?? '',
            l.countedAsTaken ? 'yes' : '',
            cairo(l.teacherJoinedAt),
            cairo(l.studentJoinedAt),
            ATTENDANCE[l.attendance ?? ''] ?? '',
            { true: 'yes', false: 'no', null: 'to check' }[
              String(teacherPaid(l))
            ] ?? '',
            l.notes?.trim() ? 'yes' : '',
            l.homeworkTitle ?? '',
          ];
        }),
      ),
    );
  }

  private range(q: RangeQuery) {
    if (q.to < q.from)
      throw new BadRequestException('The last day is before the first day.');
    const days = (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000;
    if (days > 366)
      throw new BadRequestException('Export at most one year at a time.');
    return {
      from: dayBounds(q.from, ACADEMY_TZ).from,
      to: dayBounds(q.to, ACADEMY_TZ).to,
    };
  }

  private send(res: Response, filename: string, body: string) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    return body;
  }

  private log(user: AuthUser, what: string, q: RangeQuery, count: number) {
    return this.audit.record(this.db, user, {
      action: `export.${what}`,
      entityType: 'export',
      entityId: what,
      summary: `Downloaded ${count} ${what} (${q.from} to ${q.to}) as CSV`,
    });
  }
}
