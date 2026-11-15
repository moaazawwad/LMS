import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { alias } from 'drizzle-orm/pg-core';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  lt,
  ne,
  notInArray,
  sql,
  type SQL,
} from 'drizzle-orm';
import { DateTime } from 'luxon';
import { AuditService } from '../audit/audit.service.js';
import { type AuthUser, actorKindOf, isStaff } from '../common/auth-user.js';
import { RuleViolationException } from '../common/errors.js';
import { type OverrideInput, resolveViolations } from '../common/override.js';
import { DB, type Db, type Executor, type Tx } from '../db/db.module.js';
import {
  billingCycles,
  type CancelReason,
  curricula,
  invoices,
  type LessonStatus,
  lessonCharges,
  lessonCredits,
  lessons,
  plans,
  students,
  subscriptions,
  teachers,
  users,
} from '../db/schema.js';
import { cycleIndexFor } from '../rules/billing.js';
import { teacherClockShift } from '../rules/clock.js';
import {
  canEnterClass,
  cancellationOutcome,
  checkStudentChange,
  ENTER_CLASS_OPENS_MIN_BEFORE,
  hoursUntil,
  needsReview,
  type QuotaState,
  reviewOptions,
  type RuleViolation,
  SELF_SERVICE_NOTICE_HOURS,
  statusAfterJoin,
  teacherCancelCheck,
  TEACHER_CANCELS_PER_MONTH,
  teacherLevelCheck,
  teacherPaid,
  type TeacherRemedy,
} from '../rules/lesson-rules.js';
import {
  ACADEMY_TZ,
  dayBounds,
  formatInZone,
  freeSlotsForDay,
  localDateOf,
} from '../rules/schedule.js';
import { LessonNotices } from './lesson-notices.js';
import { SchedulingService } from './scheduling.service.js';
import { teacherName } from '../common/names.js';

type LessonRow = typeof lessons.$inferSelect;

export interface LessonQuery {
  from?: Date;
  to?: Date;
  teacherId?: string;
  studentId?: string;
  status?: LessonStatus;
  /** "desc" = newest first, for history pages (page back with `to` = the oldest one shown). */
  order?: 'asc' | 'desc';
  /** 1-500, default 500 */
  limit?: number;
  /** skip this many (with `limit`), for paging */
  offset?: number;
  /** staff lists: regular, trial, extra (and makeups), cancelled, rescheduled (moved away) */
  kind?: LessonKind;
  curriculumId?: string;
}

export type LessonKind =
  'regular' | 'trial' | 'extra' | 'cancelled' | 'rescheduled';

export interface CancelInput extends OverrideInput {
  reason?: CancelReason;
  teacherRemedy?: TeacherRemedy;
  /** recording that the teacher did not come: counts toward the limit but is never blocked by it */
  teacherAbsent?: boolean;
}

export interface RescheduleInput extends OverrideInput {
  startsAt: Date;
  /** staff only: who asked for the change. Student requests use the student's quota. */
  requestedBy?: 'STUDENT' | 'TEACHER' | 'ADMIN';
}

const studentUser = alias(users, 'student_user');
const teacherUser = alias(users, 'teacher_user');

@Injectable()
export class LessonsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly scheduling: SchedulingService,
    private readonly notices: LessonNotices,
  ) {}

  // ---------------------------------------------------------------- reading

  async list(user: AuthUser, q: LessonQuery, now = new Date()) {
    const where: SQL[] = [];
    if (user.role === 'TEACHER')
      where.push(eq(lessons.teacherId, user.teacherId!));
    else if (user.role === 'STUDENT')
      where.push(eq(lessons.studentId, user.studentId!));
    else {
      if (q.teacherId) where.push(eq(lessons.teacherId, q.teacherId));
      if (q.studentId) where.push(eq(lessons.studentId, q.studentId));
    }
    if (q.from) where.push(gte(lessons.startsAt, q.from));
    if (q.to) where.push(lt(lessons.startsAt, q.to));
    if (q.status) where.push(eq(lessons.status, q.status));
    if (q.curriculumId) where.push(eq(lessons.curriculumId, q.curriculumId));
    switch (q.kind) {
      case 'regular':
        where.push(
          notInArray(lessons.type, ['TRIAL', 'EXTRA']),
          ne(lessons.status, 'RESCHEDULED'),
        );
        break;
      case 'trial':
        where.push(
          eq(lessons.type, 'TRIAL'),
          ne(lessons.status, 'RESCHEDULED'),
        );
        break;
      case 'extra':
        where.push(
          eq(lessons.type, 'EXTRA'),
          ne(lessons.status, 'RESCHEDULED'),
        );
        break;
      case 'cancelled':
        where.push(eq(lessons.status, 'CANCELLED'));
        break;
      case 'rescheduled':
        where.push(eq(lessons.status, 'RESCHEDULED'));
        break;
    }
    const rows = await this.baseQuery()
      .where(and(...where))
      .orderBy(
        q.order === 'desc' ? desc(lessons.startsAt) : asc(lessons.startsAt),
        asc(lessons.id),
      )
      .limit(Math.min(Math.max(q.limit ?? 500, 1), 500))
      .offset(Math.max(q.offset ?? 0, 0));
    const views = rows.map((r) => this.toView(r, user, now));
    // Moved-away lessons say where they went (staff lists).
    const moved = views
      .filter((v) => v.status === 'RESCHEDULED')
      .map((v) => v.id);
    if (!moved.length || !isStaff(user)) return views;
    const next = await this.db
      .select({
        from: lessons.originLessonId,
        id: lessons.id,
        startsAt: lessons.startsAt,
        teacher: teacherUser.fullName,
      })
      .from(lessons)
      .innerJoin(teachers, eq(teachers.id, lessons.teacherId))
      .innerJoin(teacherUser, eq(teacherUser.id, teachers.userId))
      .where(inArray(lessons.originLessonId, moved));
    return views.map((v) => {
      const to = next.find((n) => n.from === v.id);
      return to
        ? {
            ...v,
            movedTo: { id: to.id, startsAt: to.startsAt, teacher: to.teacher },
          }
        : v;
    });
  }

  /** Today's lessons by the academy's (Cairo) calendar day. */
  today(user: AuthUser, now = new Date()) {
    const { from, to } = dayBounds(localDateOf(now, ACADEMY_TZ), ACADEMY_TZ);
    return this.list(user, { from, to }, now);
  }

  async get(user: AuthUser, id: string, now = new Date()) {
    const [row] = await this.baseQuery().where(eq(lessons.id, id));
    if (!row) throw new NotFoundException();
    this.assertCanSee(user, row.lesson);
    const view = this.toView(row, user, now);
    if (user.role === 'STUDENT') return view;
    // The teacher's cancellations in this lesson's month: what the ask page and staff show.
    return {
      ...view,
      teacherCancels: await this.teacherCancels(
        this.db,
        row.lesson.teacherId,
        row.lesson.startsAt,
      ),
    };
  }

  // ---------------------------------------------------------------- enter class

  /** "Enter class": records attendance and returns the meeting link. */
  async enter(user: AuthUser, id: string, now = new Date()) {
    return this.db.transaction(async (tx) => {
      const lesson = await this.lockLesson(tx, id);
      this.assertCanSee(user, lesson);
      const [teacher] = await tx
        .select({ zoomLink: teachers.zoomLink })
        .from(teachers)
        .where(eq(teachers.id, lesson.teacherId));
      const zoomLink = lesson.zoomLink ?? teacher?.zoomLink ?? null;

      // Staff can open the room but it isn't attendance.
      if (isStaff(user)) return { zoomLink, status: lesson.status };

      if (lesson.status !== 'SCHEDULED' && lesson.status !== 'COMPLETED') {
        throw new ConflictException('This lesson is not taking place.');
      }
      if (!canEnterClass(lesson.startsAt, lesson.durationMin, now)) {
        throw new RuleViolationException(
          [
            {
              code: 'LESSON_NOT_SCHEDULED',
              message: `Enter class opens ${ENTER_CLASS_OPENS_MIN_BEFORE} minutes before the lesson.`,
            },
          ],
          false,
        );
      }

      const patch: Partial<LessonRow> = {};
      if (user.role === 'TEACHER' && !lesson.teacherJoinedAt)
        patch.teacherJoinedAt = now;
      if (user.role === 'STUDENT' && !lesson.studentJoinedAt)
        patch.studentJoinedAt = now;
      const teacherJoinedAt = patch.teacherJoinedAt ?? lesson.teacherJoinedAt;
      const studentJoinedAt = patch.studentJoinedAt ?? lesson.studentJoinedAt;
      const status = statusAfterJoin(
        lesson.status,
        teacherJoinedAt,
        studentJoinedAt,
      );
      if (status !== lesson.status) patch.status = status;

      if (Object.keys(patch).length) {
        await tx.update(lessons).set(patch).where(eq(lessons.id, id));
        await this.audit.record(tx, user, {
          action: 'lesson.enter',
          entityType: 'lesson',
          entityId: id,
          summary: `${user.role === 'TEACHER' ? 'Teacher' : 'Student'} entered class${status === 'COMPLETED' ? ' · lesson completed' : ''}`,
          after: patch,
        });
      }
      return { zoomLink, status };
    });
  }

  // ---------------------------------------------------------------- cancel

  cancel(user: AuthUser, id: string, input: CancelInput, now = new Date()) {
    return this.db.transaction((tx) =>
      this.cancelInTx(tx, user, id, input, now),
    );
  }

  /** The cancel itself, inside a caller's transaction (used when approving a request). */
  async cancelInTx(
    tx: Tx,
    user: AuthUser,
    id: string,
    input: CancelInput,
    now = new Date(),
  ) {
    const lesson = await this.lockLesson(tx, id);
    this.assertCanSee(user, lesson);

    let reason: CancelReason;
    let teacherRemedy: TeacherRemedy | undefined;
    if (user.role === 'TEACHER') {
      // The academy decides what the student gets (a makeup lesson or a credit), so teachers ask.
      throw new ForbiddenException(
        'Ask the academy to cancel: they arrange a makeup lesson or a credit for the student.',
      );
    }
    if (user.role === 'STUDENT') reason = 'BY_STUDENT';
    else {
      reason = input.reason ?? 'BY_ADMIN';
      teacherRemedy =
        reason === 'BY_TEACHER' ? (input.teacherRemedy ?? 'CREDIT') : undefined;
    }

    if (lesson.status !== 'SCHEDULED')
      throw new ConflictException('Only scheduled lessons can be cancelled.');
    if (!isStaff(user) && lesson.startsAt.getTime() <= now.getTime()) {
      throw new RuleViolationException(
        [
          {
            code: 'LESSON_STARTED',
            message: 'The lesson has already started.',
          },
        ],
        false,
      );
    }

    const { cycle, quota } = await this.cancelQuota(tx, lesson);
    let withinRules = true;
    let override = false;
    if (reason === 'BY_TEACHER' && !input.teacherAbsent) {
      const used = await this.teacherCancels(
        tx,
        lesson.teacherId,
        lesson.startsAt,
      );
      override = resolveViolations(
        user,
        teacherCancelCheck(used.used, used.month),
        input,
      );
    }
    if (reason === 'BY_STUDENT') {
      const check = checkStudentChange({
        action: 'cancel',
        lessonStatus: lesson.status,
        startsAt: lesson.startsAt,
        now,
        quota,
      });
      if (!check.allowed) {
        if (user.role === 'STUDENT')
          throw new RuleViolationException(check.violations, false);
        // Staff recording a late / over-quota cancel: it counts as taken, unless they override.
        if (input.override)
          override = resolveViolations(user, check.violations, input);
        else withinRules = false;
      }
    }

    // A trial lesson is free: cancelling it never gives a credit, a makeup or a charge.
    const outcome =
      lesson.type === 'TRIAL'
        ? {
            credit: false,
            countedAsTaken: false,
            makeup: false,
            usesQuota: false,
          }
        : cancellationOutcome({ reason, withinRules, teacherRemedy });
    const [updated] = await tx
      .update(lessons)
      .set({
        status: 'CANCELLED',
        cancelReason: reason,
        cancelledBy: actorKindOf(user),
        cancelledAt: now,
        countedAsTaken: outcome.countedAsTaken,
        makeupOwed: outcome.makeup,
      })
      .where(eq(lessons.id, id))
      .returning();

    if (outcome.usesQuota && cycle) {
      await tx
        .update(billingCycles)
        .set({ cancelsUsed: sql`${billingCycles.cancelsUsed} + 1` })
        .where(eq(billingCycles.id, cycle.id));
    }
    if (outcome.credit) {
      await tx
        .insert(lessonCredits)
        .values({ studentId: lesson.studentId, lessonId: lesson.id });
    }

    const notice = Math.max(0, hoursUntil(lesson.startsAt, now));
    const parts = [
      `Cancelled ${formatInZone(lesson.startsAt, ACADEMY_TZ)} Cairo`,
      reason.replace('_', ' ').toLowerCase(),
      `${notice.toFixed(1)} h notice`,
      outcome.credit
        ? 'credit to next invoice'
        : outcome.countedAsTaken
          ? 'counted as taken'
          : outcome.makeup
            ? 'makeup owed'
            : 'no credit',
    ];
    await this.audit.record(tx, user, {
      action: 'lesson.cancel',
      entityType: 'lesson',
      entityId: id,
      summary: parts.join(' · '),
      before: { status: lesson.status },
      after: { status: updated.status, cancelReason: reason, ...outcome },
      override,
      note: input.note,
    });
    await this.notices.send(
      tx,
      user,
      id,
      { kind: 'cancelled', note: input.note },
      now,
    );

    return {
      lesson: updated,
      outcome,
      quota:
        outcome.usesQuota && quota.quota !== null
          ? { ...quota, used: quota.used + 1 }
          : quota,
    };
  }

  // ---------------------------------------------------------------- reschedule

  reschedule(
    user: AuthUser,
    id: string,
    input: RescheduleInput,
    now = new Date(),
  ) {
    return this.db.transaction((tx) =>
      this.rescheduleInTx(tx, user, id, input, now),
    );
  }

  /** The move itself, inside a caller's transaction (used when approving a request). */
  async rescheduleInTx(
    tx: Tx,
    user: AuthUser,
    id: string,
    input: RescheduleInput,
    now = new Date(),
  ) {
    const lesson = await this.lockLesson(tx, id);
    this.assertCanSee(user, lesson);
    if (lesson.status !== 'SCHEDULED')
      throw new ConflictException('Only scheduled lessons can be moved.');

    const requestedBy =
      user.role === 'STUDENT'
        ? 'STUDENT'
        : user.role === 'TEACHER'
          ? 'TEACHER'
          : (input.requestedBy ?? 'ADMIN');
    const violations: RuleViolation[] = [];
    const { cycle, quota } = await this.rescheduleQuota(tx, lesson);

    if (requestedBy === 'STUDENT') {
      violations.push(
        ...checkStudentChange({
          action: 'reschedule',
          lessonStatus: lesson.status,
          startsAt: lesson.startsAt,
          now,
          quota,
        }).violations,
      );
      if (hoursUntil(input.startsAt, now) < SELF_SERVICE_NOTICE_HOURS) {
        violations.push({
          code: 'NEW_TIME_TOO_SOON',
          message: `The new time must be at least ${SELF_SERVICE_NOTICE_HOURS} hours away.`,
        });
      }
    } else {
      if (lesson.startsAt.getTime() <= now.getTime()) {
        violations.push({
          code: 'LESSON_STARTED',
          message: 'The lesson has already started.',
        });
      }
      if (input.startsAt.getTime() <= now.getTime()) {
        violations.push({
          code: 'NEW_TIME_TOO_SOON',
          message: 'The new time is in the past.',
        });
      }
    }
    violations.push(
      ...(await this.scheduling.checkSlot(tx, {
        teacherId: lesson.teacherId,
        studentId: lesson.studentId,
        startsAt: input.startsAt,
        durationMin: lesson.durationMin,
        excludeLessonId: lesson.id,
      })),
    );
    const override = resolveViolations(user, violations, input);

    await tx
      .update(lessons)
      .set({ status: 'RESCHEDULED' })
      .where(eq(lessons.id, id));
    const [moved] = await tx
      .insert(lessons)
      .values({
        subscriptionId: lesson.subscriptionId,
        cycleId: lesson.cycleId,
        studentId: lesson.studentId,
        teacherId: lesson.teacherId,
        curriculumId: lesson.curriculumId,
        startsAt: input.startsAt,
        durationMin: lesson.durationMin,
        zoomLink: lesson.zoomLink,
        type: 'RESCHEDULED',
        originLessonId: lesson.id,
      })
      .returning();

    if (requestedBy === 'STUDENT' && cycle) {
      await tx
        .update(billingCycles)
        .set({ reschedulesUsed: sql`${billingCycles.reschedulesUsed} + 1` })
        .where(eq(billingCycles.id, cycle.id));
    }

    await this.audit.record(tx, user, {
      action: 'lesson.reschedule',
      entityType: 'lesson',
      entityId: id,
      summary: `Moved ${formatInZone(lesson.startsAt, ACADEMY_TZ)} → ${formatInZone(input.startsAt, ACADEMY_TZ)} Cairo · asked by ${requestedBy.toLowerCase()}`,
      before: { startsAt: lesson.startsAt, status: lesson.status },
      after: { newLessonId: moved.id, startsAt: moved.startsAt },
      override,
      note: input.note,
    });
    await this.notices.send(
      tx,
      user,
      id,
      { kind: 'moved', to: input.startsAt },
      now,
    );
    return moved;
  }

  /**
   * What would stop the student doing this change online right now
   * (4-hour notice, quota). Shown to staff when they look at a request.
   */
  async studentChangeViolations(
    exec: Executor,
    lesson: LessonRow,
    action: 'cancel' | 'reschedule',
    now = new Date(),
  ) {
    const { quota } =
      action === 'cancel'
        ? await this.cancelQuota(exec, lesson)
        : await this.rescheduleQuota(exec, lesson);
    return checkStudentChange({
      action,
      lessonStatus: lesson.status,
      startsAt: lesson.startsAt,
      now,
      quota,
    }).violations;
  }

  /**
   * Lessons this teacher cancelled (or did not come to) in the Cairo month of
   * `at`, against the monthly limit.
   */
  async teacherCancels(exec: Executor, teacherId: string, at: Date) {
    const start = DateTime.fromJSDate(at, { zone: ACADEMY_TZ }).startOf(
      'month',
    );
    const [row] = await exec
      .select({ n: count() })
      .from(lessons)
      .where(
        and(
          eq(lessons.teacherId, teacherId),
          eq(lessons.status, 'CANCELLED'),
          eq(lessons.cancelReason, 'BY_TEACHER'),
          gte(lessons.startsAt, start.toJSDate()),
          lt(lessons.startsAt, start.plus({ months: 1 }).toJSDate()),
        ),
      );
    return {
      used: row?.n ?? 0,
      limit: TEACHER_CANCELS_PER_MONTH,
      month: start.toFormat('LLLL yyyy'),
    };
  }

  /** Teacher-cancelled lessons whose makeup is not booked yet, oldest first. */
  async makeupsOwed(
    user: AuthUser,
    q: { studentId?: string },
    now = new Date(),
  ) {
    const where: SQL[] = [eq(lessons.makeupOwed, true)];
    if (q.studentId) where.push(eq(lessons.studentId, q.studentId));
    const rows = await this.baseQuery()
      .where(and(...where))
      .orderBy(asc(lessons.startsAt))
      .limit(200);
    return rows.map((r) => this.toView(r, user, now));
  }

  /** Lesson views for a set of ids, in no particular order. */
  async viewsByIds(user: AuthUser, ids: string[], now = new Date()) {
    if (!ids.length) return [];
    const rows = await this.baseQuery().where(inArray(lessons.id, ids));
    return rows.map((r) => this.toView(r, user, now));
  }

  // ---------------------------------------------------------------- transfer

  async transfer(
    user: AuthUser,
    id: string,
    input: OverrideInput & { teacherId: string },
    now = new Date(),
  ) {
    if (!isStaff(user)) throw new ForbiddenException();
    return this.db.transaction(async (tx) => {
      const lesson = await this.lockLesson(tx, id);
      if (lesson.status !== 'SCHEDULED')
        throw new ConflictException(
          'Only scheduled lessons can be transferred.',
        );
      if (input.teacherId === lesson.teacherId)
        throw new BadRequestException('That is already the teacher.');
      const violations = await this.teacherChangeViolations(
        tx,
        lesson,
        input.teacherId,
        now,
      );
      const override = resolveViolations(user, violations, input);

      await tx
        .update(lessons)
        .set({ status: 'RESCHEDULED' })
        .where(eq(lessons.id, id));
      const [moved] = await tx
        .insert(lessons)
        .values({
          subscriptionId: lesson.subscriptionId,
          cycleId: lesson.cycleId,
          studentId: lesson.studentId,
          teacherId: input.teacherId,
          curriculumId: lesson.curriculumId,
          startsAt: lesson.startsAt,
          durationMin: lesson.durationMin,
          type: 'TRANSFERRED',
          originLessonId: lesson.id,
        })
        .returning();

      await this.audit.record(tx, user, {
        action: 'lesson.transfer',
        entityType: 'lesson',
        entityId: id,
        summary: `Moved the lesson of ${formatInZone(lesson.startsAt, ACADEMY_TZ)} Cairo from ${await teacherName(tx, lesson.teacherId)} to ${await teacherName(tx, input.teacherId)}`,
        before: { teacherId: lesson.teacherId },
        after: { teacherId: input.teacherId, newLessonId: moved.id },
        override,
        note: input.note,
      });
      return moved;
    });
  }

  /** Level, curriculum, availability and clash checks for putting a lesson on another teacher. */
  async teacherChangeViolations(
    exec: Executor,
    lesson: LessonRow,
    teacherId: string,
    now: Date,
  ): Promise<RuleViolation[]> {
    const [teacher] = await exec
      .select()
      .from(teachers)
      .where(eq(teachers.id, teacherId));
    if (!teacher || teacher.status !== 'ACTIVE')
      throw new BadRequestException('Unknown or inactive teacher.');
    const violations: RuleViolation[] = [];
    if (lesson.startsAt.getTime() <= now.getTime()) {
      violations.push({
        code: 'LESSON_STARTED',
        message: 'The lesson has already started.',
      });
    }
    if (lesson.subscriptionId) {
      const [sub] = await exec
        .select({ tier: plans.tier })
        .from(subscriptions)
        .innerJoin(plans, eq(plans.id, subscriptions.planId))
        .where(eq(subscriptions.id, lesson.subscriptionId));
      if (sub && teacherLevelCheck(teacher.level, sub.tier) === 'LOWER') {
        violations.push({
          code: 'TEACHER_LEVEL_TOO_LOW',
          message: `A ${teacher.level.toLowerCase()} teacher for a ${sub.tier.toLowerCase()} plan.`,
        });
      }
    }
    if (
      !(await this.scheduling.teachesCurriculum(
        exec,
        teacherId,
        lesson.curriculumId,
      ))
    ) {
      violations.push({
        code: 'CURRICULUM_NOT_TAUGHT',
        message: 'The teacher does not teach this curriculum.',
      });
    }
    violations.push(
      ...(await this.scheduling.checkSlot(exec, {
        teacherId,
        studentId: lesson.studentId,
        startsAt: lesson.startsAt,
        durationMin: lesson.durationMin,
        excludeLessonId: lesson.id,
      })),
    );
    return violations;
  }

  // ---------------------------------------------------------------- notes & homework

  async saveNotes(
    user: AuthUser,
    id: string,
    body: { notes?: string; homeworkTitle?: string; homeworkBody?: string },
  ) {
    if (user.role === 'STUDENT') throw new ForbiddenException();
    return this.db.transaction(async (tx) => {
      const lesson = await this.lockLesson(tx, id);
      this.assertCanSee(user, lesson);
      const [row] = await tx
        .update(lessons)
        .set(body)
        .where(eq(lessons.id, id))
        .returning();
      await this.audit.record(tx, user, {
        action: 'lesson.notes',
        entityType: 'lesson',
        entityId: id,
        summary: body.homeworkTitle
          ? `Saved notes and homework "${body.homeworkTitle}"`
          : 'Saved lesson notes',
        before: {
          notes: lesson.notes,
          homeworkTitle: lesson.homeworkTitle,
          homeworkBody: lesson.homeworkBody,
        },
        after: body,
      });
      return row;
    });
  }

  // ---------------------------------------------------------------- free slots

  /** Times this lesson can move to on one of the student's local days. */
  async freeSlots(
    user: AuthUser,
    id: string,
    localDate: string,
    now = new Date(),
  ) {
    if (user.role === 'TEACHER') throw new ForbiddenException();
    const [row] = await this.db
      .select({
        lesson: lessons,
        subTz: subscriptions.timezone,
        userTz: studentUser.timezone,
      })
      .from(lessons)
      .innerJoin(students, eq(students.id, lessons.studentId))
      .innerJoin(studentUser, eq(studentUser.id, students.userId))
      .leftJoin(subscriptions, eq(subscriptions.id, lessons.subscriptionId))
      .where(eq(lessons.id, id));
    if (!row) throw new NotFoundException();
    this.assertCanSee(user, row.lesson);
    const studentTz = row.subTz ?? row.userTz;

    const dayStart = new Date(`${localDate}T00:00:00Z`);
    const windows = await this.scheduling.teacherWindows(
      this.db,
      row.lesson.teacherId,
    );
    const booked = await this.scheduling.busyNear(
      this.db,
      { teacherId: row.lesson.teacherId, studentId: row.lesson.studentId },
      new Date(dayStart.getTime() - 86_400_000),
      new Date(dayStart.getTime() + 2 * 86_400_000),
      row.lesson.id,
    );
    const slots = freeSlotsForDay({
      teacherWindows: windows,
      booked,
      studentTz,
      localDate,
      durationMin: row.lesson.durationMin,
      now,
      minNoticeHours: user.role === 'STUDENT' ? SELF_SERVICE_NOTICE_HOURS : 0,
    });
    return {
      timezone: studentTz,
      slots: slots.map((startsAt) => ({
        startsAt,
        local: formatInZone(startsAt, studentTz, 'h:mm a'),
        cairo: formatInZone(startsAt, ACADEMY_TZ, 'h:mm a'),
      })),
    };
  }

  /**
   * Times a new lesson for this subscription could start on one of the
   * student's local days: inside the teacher's hours, clear of the teacher's
   * and the student's lessons. For staff adding an extra or makeup lesson,
   * so half-hour steps and no notice period.
   */
  async freeSlotsForSubscription(
    subscriptionId: string,
    localDate: string,
    now = new Date(),
  ) {
    const sub = await this.db.query.subscriptions.findFirst({
      where: eq(subscriptions.id, subscriptionId),
      with: { plan: true },
    });
    if (!sub) throw new NotFoundException('Subscription not found');
    const dayStart = new Date(`${localDate}T00:00:00Z`);
    const windows = await this.scheduling.teacherWindows(
      this.db,
      sub.teacherId,
    );
    const booked = await this.scheduling.busyNear(
      this.db,
      { teacherId: sub.teacherId, studentId: sub.studentId },
      new Date(dayStart.getTime() - 86_400_000),
      new Date(dayStart.getTime() + 2 * 86_400_000),
    );
    const slots = freeSlotsForDay({
      teacherWindows: windows,
      booked,
      studentTz: sub.timezone,
      localDate,
      durationMin: sub.plan.lessonMinutes,
      now,
      minNoticeHours: 0,
      stepMin: 30,
    });
    return {
      timezone: sub.timezone,
      durationMin: sub.plan.lessonMinutes,
      slots: slots.map((startsAt) => ({
        startsAt,
        local: formatInZone(startsAt, sub.timezone, 'h:mm a'),
        cairo: formatInZone(startsAt, ACADEMY_TZ, 'h:mm a'),
      })),
    };
  }

  /** A teacher's free times on a student's day, for a one-off (trial) lesson. */
  async freeSlotsForTeacher(input: {
    teacherId: string;
    studentId: string;
    localDate: string;
    durationMin: number;
    now?: Date;
  }) {
    const [student] = await this.db
      .select({ tz: studentUser.timezone })
      .from(students)
      .innerJoin(studentUser, eq(studentUser.id, students.userId))
      .where(eq(students.id, input.studentId));
    if (!student) throw new NotFoundException('Student not found');
    const dayStart = new Date(`${input.localDate}T00:00:00Z`);
    const windows = await this.scheduling.teacherWindows(
      this.db,
      input.teacherId,
    );
    const booked = await this.scheduling.busyNear(
      this.db,
      { teacherId: input.teacherId, studentId: input.studentId },
      new Date(dayStart.getTime() - 86_400_000),
      new Date(dayStart.getTime() + 2 * 86_400_000),
    );
    const slots = freeSlotsForDay({
      teacherWindows: windows,
      booked,
      studentTz: student.tz,
      localDate: input.localDate,
      durationMin: input.durationMin,
      now: input.now ?? new Date(),
      minNoticeHours: 0,
      stepMin: 30,
    });
    return {
      timezone: student.tz,
      durationMin: input.durationMin,
      slots: slots.map((startsAt) => ({
        startsAt,
        local: formatInZone(startsAt, student.tz, 'h:mm a'),
        cairo: formatInZone(startsAt, ACADEMY_TZ, 'h:mm a'),
      })),
    };
  }

  /**
   * Everything around one lesson, for the staff lesson page: where it came
   * from and went to, who cancelled or checked it, its invoice, credit or
   * charge, and the meeting link.
   */
  async history(id: string) {
    const [l] = await this.db.select().from(lessons).where(eq(lessons.id, id));
    if (!l) throw new NotFoundException();
    const pick = {
      id: lessons.id,
      startsAt: lessons.startsAt,
      status: lessons.status,
      type: lessons.type,
      teacher: teacherUser.fullName,
    };
    const from = l.originLessonId
      ? await this.db
          .select(pick)
          .from(lessons)
          .innerJoin(teachers, eq(teachers.id, lessons.teacherId))
          .innerJoin(teacherUser, eq(teacherUser.id, teachers.userId))
          .where(eq(lessons.id, l.originLessonId))
      : [];
    const to = await this.db
      .select(pick)
      .from(lessons)
      .innerJoin(teachers, eq(teachers.id, lessons.teacherId))
      .innerJoin(teacherUser, eq(teacherUser.id, teachers.userId))
      .where(eq(lessons.originLessonId, id));
    const [reviewer] = l.reviewedById
      ? await this.db
          .select({ name: users.fullName })
          .from(users)
          .where(eq(users.id, l.reviewedById))
      : [];
    const [teacher] = await this.db
      .select({ zoom: teachers.zoomLink })
      .from(teachers)
      .where(eq(teachers.id, l.teacherId));
    const [cycleInvoice] = l.cycleId
      ? await this.db
          .select({
            id: invoices.id,
            number: invoices.number,
            status: invoices.status,
          })
          .from(invoices)
          .where(
            and(eq(invoices.cycleId, l.cycleId), ne(invoices.status, 'VOID')),
          )
          .limit(1)
      : [];
    const money = (table: typeof lessonCredits | typeof lessonCharges) =>
      this.db
        .select({
          status: table.status,
          invoiceId: invoices.id,
          invoice: invoices.number,
        })
        .from(table)
        .leftJoin(invoices, eq(invoices.id, table.invoiceId))
        .where(eq(table.lessonId, id));
    const [credit] = await money(lessonCredits);
    const [charge] = await money(lessonCharges);
    return {
      meetingLink: l.zoomLink ?? teacher?.zoom ?? null,
      createdAt: l.createdAt,
      cancelledAt: l.cancelledAt,
      cancelledBy: l.cancelledBy,
      closedAt: l.closedAt,
      reviewedAt: l.reviewedAt,
      reviewedBy: reviewer?.name ?? null,
      movedFrom: from[0] ?? null,
      movedTo: to,
      invoice: cycleInvoice ?? null,
      credit: credit ?? null,
      charge: charge ?? null,
    };
  }

  // ---------------------------------------------------------------- extra lesson

  /**
   * A free trial lesson: one time only, no subscription and no invoice.
   * Checked against the teacher's hours, curriculum and other lessons.
   */
  async addTrial(
    user: AuthUser,
    input: OverrideInput & {
      studentId: string;
      teacherId: string;
      curriculumId: string;
      startsAt: Date;
      durationMin: number;
    },
    now = new Date(),
  ) {
    if (!isStaff(user)) throw new ForbiddenException();
    return this.db.transaction(async (tx) => {
      const [student] = await tx
        .select({ id: students.id, name: studentUser.fullName })
        .from(students)
        .innerJoin(studentUser, eq(studentUser.id, students.userId))
        .where(eq(students.id, input.studentId));
      if (!student) throw new NotFoundException('Student not found');
      const [teacher] = await tx
        .select({
          id: teachers.id,
          status: teachers.status,
          name: teacherUser.fullName,
        })
        .from(teachers)
        .innerJoin(teacherUser, eq(teacherUser.id, teachers.userId))
        .where(eq(teachers.id, input.teacherId));
      if (!teacher || teacher.status !== 'ACTIVE')
        throw new BadRequestException('Unknown or inactive teacher.');
      const [curriculum] = await tx
        .select({ id: curricula.id, name: curricula.name })
        .from(curricula)
        .where(eq(curricula.id, input.curriculumId));
      if (!curriculum) throw new BadRequestException('Unknown curriculum.');

      const violations: RuleViolation[] = [];
      if (input.startsAt.getTime() <= now.getTime())
        violations.push({
          code: 'NEW_TIME_TOO_SOON',
          message: 'The time is in the past.',
        });
      if (
        !(await this.scheduling.teachesCurriculum(
          tx,
          teacher.id,
          curriculum.id,
        ))
      )
        violations.push({
          code: 'CURRICULUM_NOT_TAUGHT',
          message: 'The teacher does not teach this curriculum.',
        });
      violations.push(
        ...(await this.scheduling.checkSlot(tx, {
          teacherId: teacher.id,
          studentId: student.id,
          startsAt: input.startsAt,
          durationMin: input.durationMin,
        })),
      );
      const override = resolveViolations(user, violations, input);

      const [row] = await tx
        .insert(lessons)
        .values({
          subscriptionId: null,
          cycleId: null,
          studentId: student.id,
          teacherId: teacher.id,
          curriculumId: curriculum.id,
          startsAt: input.startsAt,
          durationMin: input.durationMin,
          type: 'TRIAL',
        })
        .returning();
      await this.audit.record(tx, user, {
        action: 'lesson.trial',
        entityType: 'lesson',
        entityId: row.id,
        summary: `Booked a free trial lesson for ${student.name} with ${teacher.name}: ${formatInZone(input.startsAt, ACADEMY_TZ)} Cairo, ${input.durationMin} min, ${curriculum.name}`,
        after: row,
        override,
        note: input.note,
      });
      return row;
    });
  }

  async addExtra(
    user: AuthUser,
    input: OverrideInput & {
      subscriptionId: string;
      startsAt: Date;
      extraReason: 'MAKEUP' | 'OTHER';
      forLessonId?: string;
      teacherId?: string;
      curriculumId?: string;
    },
    now = new Date(),
  ) {
    if (!isStaff(user)) throw new ForbiddenException();
    return this.db.transaction(async (tx) => {
      const sub = await tx.query.subscriptions.findFirst({
        where: eq(subscriptions.id, input.subscriptionId),
        with: { plan: true },
      });
      if (!sub) throw new NotFoundException('Subscription not found');
      // A makeup can say which owed lesson it replaces.
      let replaces: LessonRow | null = null;
      if (input.forLessonId) {
        if (input.extraReason !== 'MAKEUP')
          throw new BadRequestException(
            'Only a makeup lesson replaces another lesson.',
          );
        replaces = await this.lockLesson(tx, input.forLessonId);
        if (replaces.studentId !== sub.studentId)
          throw new BadRequestException(
            'That lesson belongs to another student.',
          );
        if (!replaces.makeupOwed)
          throw new ConflictException('No makeup is owed for that lesson.');
      }
      // This one lesson can be with another teacher or on another curriculum.
      const teacherId = input.teacherId ?? sub.teacherId;
      const curriculumId = input.curriculumId ?? sub.curriculumId;
      let other: { name: string } | null = null;
      if (teacherId !== sub.teacherId) {
        const [t] = await tx
          .select({ status: teachers.status, name: users.fullName })
          .from(teachers)
          .innerJoin(users, eq(users.id, teachers.userId))
          .where(eq(teachers.id, teacherId));
        if (!t) throw new NotFoundException('Teacher not found');
        if (t.status !== 'ACTIVE')
          throw new BadRequestException('That teacher is not active.');
        other = { name: t.name };
      }
      if (curriculumId !== sub.curriculumId) {
        const [c] = await tx
          .select({ id: curricula.id })
          .from(curricula)
          .where(eq(curricula.id, curriculumId));
        if (!c) throw new NotFoundException('Curriculum not found');
      }
      const violations: RuleViolation[] = [];
      if (input.startsAt.getTime() <= now.getTime()) {
        violations.push({
          code: 'NEW_TIME_TOO_SOON',
          message: 'The time is in the past.',
        });
      }
      violations.push(
        ...(await this.scheduling.checkSlot(tx, {
          teacherId,
          studentId: sub.studentId,
          startsAt: input.startsAt,
          durationMin: sub.plan.lessonMinutes,
        })),
      );
      const override = resolveViolations(user, violations, input);

      const index = cycleIndexFor(
        sub.startDate,
        localDateOf(input.startsAt, sub.timezone),
      );
      const [cycle] = await tx
        .select({ id: billingCycles.id })
        .from(billingCycles)
        .where(
          and(
            eq(billingCycles.subscriptionId, sub.id),
            eq(billingCycles.index, index),
          ),
        );

      const [row] = await tx
        .insert(lessons)
        .values({
          subscriptionId: sub.id,
          cycleId: cycle?.id ?? null,
          studentId: sub.studentId,
          teacherId,
          curriculumId,
          startsAt: input.startsAt,
          durationMin: sub.plan.lessonMinutes,
          type: 'EXTRA',
          extraReason: input.extraReason,
          originLessonId: replaces?.id ?? null,
        })
        .returning();
      if (replaces)
        await tx
          .update(lessons)
          .set({ makeupOwed: false })
          .where(eq(lessons.id, replaces.id));

      // A makeup replaces a lesson already paid for. An extra lesson costs the
      // plan price: on this cycle's invoice while it is unpaid, else the next one.
      let billing: { invoiceNumber: string | null; pending: boolean } | null =
        null;
      if (input.extraReason === 'OTHER') {
        const [open] = cycle
          ? await tx
              .select()
              .from(invoices)
              .where(
                and(
                  eq(invoices.cycleId, cycle.id),
                  eq(invoices.status, 'OPEN'),
                ),
              )
              .for('update')
          : [];
        if (open) {
          await tx
            .update(invoices)
            .set({
              extraCount: open.extraCount + 1,
              billedLessons: open.billedLessons + 1,
              totalCents: open.totalCents + open.priceCents,
            })
            .where(eq(invoices.id, open.id));
          await tx.insert(lessonCharges).values({
            studentId: sub.studentId,
            lessonId: row.id,
            status: 'APPLIED',
            invoiceId: open.id,
          });
          billing = { invoiceNumber: open.number, pending: false };
        } else {
          await tx
            .insert(lessonCharges)
            .values({ studentId: sub.studentId, lessonId: row.id });
          billing = { invoiceNumber: null, pending: true };
        }
      }

      const billed = billing
        ? billing.pending
          ? ' · billed on the next invoice'
          : ` · added to ${billing.invoiceNumber}`
        : '';
      await this.audit.record(tx, user, {
        action: 'lesson.extra',
        entityType: 'lesson',
        entityId: row.id,
        summary: `Added ${input.extraReason === 'MAKEUP' ? 'makeup' : 'extra'} lesson ${formatInZone(input.startsAt, ACADEMY_TZ)} Cairo${other ? ` with ${other.name}` : ''}${replaces ? ` for the lesson of ${formatInZone(replaces.startsAt, ACADEMY_TZ)}` : ''}${billed}`,
        after: { ...row, billing },
        override,
        note: input.note,
      });
      return { ...row, billing };
    });
  }

  // ---------------------------------------------------------------- helpers

  private baseQuery() {
    return this.db
      .select({
        lesson: lessons,
        studentName: studentUser.fullName,
        studentTz: studentUser.timezone,
        teacherName: teacherUser.fullName,
        teacherZoom: teachers.zoomLink,
        curriculum: curricula.name,
        plan: plans.tier,
        subTz: subscriptions.timezone,
      })
      .from(lessons)
      .innerJoin(students, eq(students.id, lessons.studentId))
      .innerJoin(studentUser, eq(studentUser.id, students.userId))
      .innerJoin(teachers, eq(teachers.id, lessons.teacherId))
      .innerJoin(teacherUser, eq(teacherUser.id, teachers.userId))
      .innerJoin(curricula, eq(curricula.id, lessons.curriculumId))
      .leftJoin(subscriptions, eq(subscriptions.id, lessons.subscriptionId))
      .leftJoin(plans, eq(plans.id, subscriptions.planId));
  }

  private toView(
    r: {
      lesson: LessonRow;
      studentName: string;
      studentTz: string;
      teacherName: string;
      teacherZoom: string | null;
      curriculum: string;
      plan: string | null;
      subTz: string | null;
    },
    user: AuthUser,
    now: Date,
  ) {
    const l = r.lesson;
    const ends = l.startsAt.getTime() + l.durationMin * 60_000;
    const mine =
      (user.role === 'TEACHER' && user.teacherId === l.teacherId) ||
      (user.role === 'STUDENT' && user.studentId === l.studentId);
    const staff = isStaff(user);
    const review = needsReview(l);
    return {
      id: l.id,
      startsAt: l.startsAt,
      durationMin: l.durationMin,
      type: l.type,
      extraReason: l.extraReason,
      status: l.status,
      cancelReason: l.cancelReason,
      countedAsTaken: l.countedAsTaken,
      /** the teacher cancelled; a makeup lesson is still to be booked */
      makeupOwed: l.makeupOwed,
      originLessonId: l.originLessonId,
      teacherJoinedAt: l.teacherJoinedAt,
      studentJoinedAt: l.studentJoinedAt,
      subscriptionId: l.subscriptionId,
      student: {
        id: l.studentId,
        name: r.studentName,
        timezone: r.subTz ?? r.studentTz,
      },
      teacher: { id: l.teacherId, name: r.teacherName },
      curriculum: r.curriculum,
      plan: r.plan,
      notes: l.notes,
      homeworkTitle: l.homeworkTitle,
      homeworkBody: l.homeworkBody,
      homeworkAnswer: l.homeworkAnswer,
      homeworkSentAt: l.homeworkSentAt,
      homeworkFeedback: l.homeworkFeedback,
      homeworkCheckedAt: l.homeworkCheckedAt,
      canEnter:
        mine &&
        (l.status === 'SCHEDULED' || l.status === 'COMPLETED') &&
        canEnterClass(l.startsAt, l.durationMin, now),
      /** past its end with nobody (or one side) having entered */
      missed: l.status === 'SCHEDULED' && ends < now.getTime(),
      /**
       * Upcoming lessons: minutes later (+) or earlier (-) on the Cairo clock
       * than the same time today, because a clock change falls in between.
       */
      clockShiftMin:
        l.status === 'SCHEDULED' && ends > now.getTime()
          ? teacherClockShift(l.startsAt, r.subTz ?? r.studentTz, now)
          : 0,
      /** settled after the lesson: BOTH, TEACHER_ONLY (student absent), STUDENT_ONLY, NONE */
      attendance: l.attendance,
      /** null until settled. Only staff see it. */
      teacherPaid: staff ? teacherPaid(l) : undefined,
      /** not attended by both and nobody at the academy has looked yet */
      needsReview: staff ? review : undefined,
      /** what staff can record about it */
      reviewOptions: staff && review ? reviewOptions(l.attendance) : undefined,
    };
  }

  private async lockLesson(tx: Tx, id: string): Promise<LessonRow> {
    const [lesson] = await tx
      .select()
      .from(lessons)
      .where(eq(lessons.id, id))
      .for('update');
    if (!lesson) throw new NotFoundException();
    return lesson;
  }

  private assertCanSee(user: AuthUser, lesson: LessonRow) {
    if (isStaff(user)) return;
    if (user.role === 'TEACHER' && user.teacherId === lesson.teacherId) return;
    if (user.role === 'STUDENT' && user.studentId === lesson.studentId) return;
    throw new ForbiddenException();
  }

  private async cycleAndPlan(exec: Executor, lesson: LessonRow) {
    if (!lesson.cycleId || !lesson.subscriptionId)
      return { cycle: null, plan: null };
    const [row] = await exec
      .select({ cycle: billingCycles, plan: plans })
      .from(billingCycles)
      .innerJoin(
        subscriptions,
        eq(subscriptions.id, billingCycles.subscriptionId),
      )
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(eq(billingCycles.id, lesson.cycleId));
    return { cycle: row?.cycle ?? null, plan: row?.plan ?? null };
  }

  private async cancelQuota(
    exec: Executor,
    lesson: LessonRow,
  ): Promise<{ cycle: { id: string } | null; quota: QuotaState }> {
    const { cycle, plan } = await this.cycleAndPlan(exec, lesson);
    return {
      cycle,
      quota: {
        quota: plan?.cancelQuota ?? null,
        used: cycle?.cancelsUsed ?? 0,
      },
    };
  }

  private async rescheduleQuota(
    exec: Executor,
    lesson: LessonRow,
  ): Promise<{ cycle: { id: string } | null; quota: QuotaState }> {
    const { cycle, plan } = await this.cycleAndPlan(exec, lesson);
    return {
      cycle,
      quota: {
        quota: plan?.rescheduleQuota ?? null,
        used: cycle?.reschedulesUsed ?? 0,
      },
    };
  }
}
