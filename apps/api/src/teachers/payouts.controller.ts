import { ApiTags } from '@nestjs/swagger';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { and, desc, eq, type SQL } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { AuditService } from '../audit/audit.service.js';
import { type AuthUser, CurrentUser, Roles } from '../common/auth-user.js';
import { resolveViolations } from '../common/override.js';
import { DB, type Db } from '../db/db.module.js';
import { teacherPayouts, teachers, users } from '../db/schema.js';
import type { RuleViolation } from '../rules/lesson-rules.js';
import { ACADEMY_TZ } from '../rules/schedule.js';
import { payFor, teacherLessonRows } from '../stats/teacher-lessons.js';
import { teacherRate } from './pay-rate.js';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

class PayoutQueryDto {
  /** YYYY-MM: every teacher paid for that month */
  @IsOptional()
  @Matches(MONTH, { message: 'month must look like 2026-10' })
  month?: string;
  /** one teacher's payouts, newest first */
  @IsOptional() @IsUUID() teacherId?: string;
}

class RecordPayoutDto {
  @IsUUID() teacherId: string;
  @Matches(MONTH, { message: 'month must look like 2026-10' }) month: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsOptional() @IsBoolean() override?: boolean;
}

class UndoPayoutDto {
  @IsString() @MinLength(3) @MaxLength(500) note: string;
}

/** "October 2026" */
const monthName = (month: string) =>
  DateTime.fromISO(`${month}-01`).toFormat('LLLL yyyy');

/** The Cairo month as [first instant, first instant of the next month). */
function monthBounds(month: string) {
  const start = DateTime.fromISO(`${month}-01`, { zone: ACADEMY_TZ }).startOf(
    'day',
  );
  return { from: start.toJSDate(), to: start.plus({ months: 1 }).toJSDate() };
}

/**
 * Recording that a teacher was paid for a month. Admin only: amounts never
 * reach staff, and the activity log says what was paid for, not how much.
 */
@ApiTags('Teacher pay')
@Controller('payouts')
@Roles('ADMIN')
export class PayoutsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@Query() q: PayoutQueryDto) {
    if (!q.month && !q.teacherId)
      throw new BadRequestException('Give a month or a teacher.');
    const where: SQL[] = [];
    if (q.month) where.push(eq(teacherPayouts.month, q.month));
    if (q.teacherId) where.push(eq(teacherPayouts.teacherId, q.teacherId));
    return this.db
      .select({
        id: teacherPayouts.id,
        teacherId: teacherPayouts.teacherId,
        teacherName: users.fullName,
        month: teacherPayouts.month,
        lessons: teacherPayouts.lessons,
        minutes: teacherPayouts.minutes,
        rateCents: teacherPayouts.rateCents,
        amountCents: teacherPayouts.amountCents,
        currency: teacherPayouts.currency,
        paidAt: teacherPayouts.paidAt,
        note: teacherPayouts.note,
      })
      .from(teacherPayouts)
      .innerJoin(teachers, eq(teachers.id, teacherPayouts.teacherId))
      .innerJoin(users, eq(users.id, teachers.userId))
      .where(and(...where))
      .orderBy(desc(teacherPayouts.month), users.fullName)
      .limit(120);
  }

  /**
   * Record a month's pay as paid, frozen at today's count. Paying before the
   * month is over, or while some of its lessons are still to check, needs an
   * override with a note.
   */
  @Post()
  async record(@CurrentUser() user: AuthUser, @Body() body: RecordPayoutDto) {
    const now = new Date();
    const [found] = await this.db
      .select({ id: teachers.id, name: users.fullName })
      .from(teachers)
      .innerJoin(users, eq(users.id, teachers.userId))
      .where(eq(teachers.id, body.teacherId));
    if (!found) throw new NotFoundException('Teacher not found');
    const rate = (await teacherRate(this.db, found.id))!;
    if (rate.rateCents === null)
      throw new BadRequestException(
        `Set ${found.name}'s hourly rate first: on their page, or for their level on Lessons to pay.`,
      );
    const teacher = { ...found, ...rate, rateCents: rate.rateCents };

    const { from, to } = monthBounds(body.month);
    if (from.getTime() > now.getTime())
      throw new BadRequestException('That month has not started yet.');
    const [row] = await teacherLessonRows(this.db, from, to, teacher.id);
    if (!row?.paid)
      throw new BadRequestException(
        `${teacher.name} has no paid lessons in ${monthName(body.month)}.`,
      );

    const violations: RuleViolation[] = [];
    if (to.getTime() > now.getTime()) {
      violations.push({
        code: 'PAY_MONTH_NOT_OVER',
        message: `${monthName(body.month)} is not over yet; later lessons would not be in this payment.`,
      });
    }
    if (row.toCheck > 0) {
      violations.push({
        code: 'PAY_LESSONS_TO_CHECK',
        message: `${row.toCheck === 1 ? '1 lesson' : `${row.toCheck} lessons`} this month still need checking: the teacher did not enter.`,
      });
    }
    const override = resolveViolations(user, violations, body);

    const amountCents = payFor(row.paidMinutes, teacher.rateCents)!;
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ paidAt: teacherPayouts.paidAt })
        .from(teacherPayouts)
        .where(
          and(
            eq(teacherPayouts.teacherId, teacher.id),
            eq(teacherPayouts.month, body.month),
          ),
        );
      if (existing) {
        throw new ConflictException(
          `${teacher.name}'s pay for ${monthName(body.month)} was already recorded on ${DateTime.fromJSDate(existing.paidAt, { zone: ACADEMY_TZ }).toFormat('LLL d')}.`,
        );
      }
      const [payout] = await tx
        .insert(teacherPayouts)
        .values({
          teacherId: teacher.id,
          month: body.month,
          lessons: row.paid,
          minutes: row.paidMinutes,
          rateCents: teacher.rateCents!,
          amountCents,
          currency: teacher.currency,
          paidAt: now,
          paidById: user.userId,
          note: body.note?.trim() || null,
        })
        .returning();
      await this.audit.record(tx, user, {
        action: 'teacher.payout',
        entityType: 'teacher',
        entityId: teacher.id,
        // No amounts: staff can read the log.
        summary: `${teacher.name}: ${monthName(body.month)} pay recorded as paid · ${row.paid} lessons, ${+(row.paidMinutes / 60).toFixed(2)} hours${override ? ' · override' : ''}`,
        after: {
          month: body.month,
          lessons: row.paid,
          minutes: row.paidMinutes,
        },
        note: body.note,
      });
      return payout;
    });
  }

  /** A payment recorded by mistake. */
  @Post(':id/undo')
  @HttpCode(200)
  async undo(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UndoPayoutDto,
  ) {
    const note = body.note.trim();
    if (note.length < 3)
      throw new BadRequestException('Say why the payment is undone.');
    return this.db.transaction(async (tx) => {
      const [payout] = await tx
        .select({ p: teacherPayouts, name: users.fullName })
        .from(teacherPayouts)
        .innerJoin(teachers, eq(teachers.id, teacherPayouts.teacherId))
        .innerJoin(users, eq(users.id, teachers.userId))
        .where(eq(teacherPayouts.id, id))
        .for('update');
      if (!payout) throw new NotFoundException();
      await tx.delete(teacherPayouts).where(eq(teacherPayouts.id, id));
      await this.audit.record(tx, user, {
        action: 'teacher.payout-undo',
        entityType: 'teacher',
        entityId: payout.p.teacherId,
        summary: `${payout.name}: ${monthName(payout.p.month)} pay no longer recorded as paid`,
        before: {
          month: payout.p.month,
          lessons: payout.p.lessons,
          minutes: payout.p.minutes,
        },
        note,
      });
      return { id };
    });
  }
}
