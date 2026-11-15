import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { and, asc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { DB, type Db } from '../db/db.module.js';
import { lessons } from '../db/schema.js';
import {
  type Attendance,
  attendanceOf,
  CLOSE_AFTER_END_MIN,
  closeOutcome,
  type ReviewOutcome,
  reviewOptions,
  reviewResult,
  type TeacherRemedy,
} from '../rules/lesson-rules.js';
import { ACADEMY_TZ, formatInZone } from '../rules/schedule.js';
import { LessonsService } from './lessons.service.js';

const WHO: Record<Attendance, string> = {
  BOTH: 'both entered',
  TEACHER_ONLY: 'student did not enter',
  STUDENT_ONLY: 'teacher did not enter',
  NONE: 'nobody entered',
};

const OUTCOME_TEXT: Record<ReviewOutcome, string> = {
  CONFIRM: 'student absent confirmed',
  HELD: 'lesson was held',
  STUDENT_ABSENT: 'student was absent',
  NOBODY_CAME: 'nobody came',
  TEACHER_ABSENT: 'teacher did not come',
};

export interface ReviewInput {
  outcome: ReviewOutcome;
  /** TEACHER_ABSENT only: what the student gets. Default: a credit. */
  teacherRemedy?: TeacherRemedy;
  note?: string;
}

/**
 * After a lesson ends, settles who came (from the Enter class presses):
 * both → held; only the teacher → student absent, still counted and paid;
 * the teacher missing → not paid, and staff decide what happened.
 * Anything but "both" shows up for staff to check.
 */
@Injectable()
export class AttendanceService implements OnApplicationBootstrap {
  private readonly log = new Logger(AttendanceService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly lessons: LessonsService,
  ) {}

  onApplicationBootstrap() {
    // Catch up after a restart; tests call closeEnded themselves.
    if (process.env.NODE_ENV === 'test') return;
    this.closeEnded().catch((err: Error) =>
      this.log.warn(`Could not settle finished lessons: ${err.message}`),
    );
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async closeEnded(now: Date = new Date()): Promise<number> {
    const due = await this.db
      .select({ id: lessons.id })
      .from(lessons)
      .where(
        and(
          isNull(lessons.closedAt),
          inArray(lessons.status, ['SCHEDULED', 'COMPLETED']),
          sql`${lessons.startsAt} + make_interval(mins => ${lessons.durationMin} + ${CLOSE_AFTER_END_MIN}) <= ${now}`,
        ),
      )
      .orderBy(asc(lessons.startsAt))
      .limit(1000);
    let closed = 0;
    for (const { id } of due) {
      if (await this.closeOne(id, now)) closed++;
    }
    return closed;
  }

  private closeOne(id: string, now: Date) {
    return this.db.transaction(async (tx) => {
      const [l] = await tx
        .select()
        .from(lessons)
        .where(eq(lessons.id, id))
        .for('update');
      // Someone else (another run, a cancel) got there first.
      if (
        !l ||
        l.closedAt ||
        (l.status !== 'SCHEDULED' && l.status !== 'COMPLETED')
      )
        return false;
      const attendance = attendanceOf(l.teacherJoinedAt, l.studentJoinedAt);
      const { status, needsReview } = closeOutcome(attendance);
      await tx
        .update(lessons)
        .set({ attendance, status, closedAt: now })
        .where(eq(lessons.id, id));
      if (needsReview) {
        await this.audit.record(tx, null, {
          action: 'lesson.attendance',
          entityType: 'lesson',
          entityId: id,
          summary: `${formatInZone(l.startsAt, ACADEMY_TZ)} Cairo · ${WHO[attendance]}${attendance === 'TEACHER_ONLY' ? ' · counted, teacher paid' : ' · teacher not paid · to check'}`,
          before: { status: l.status },
          after: { status, attendance },
        });
      }
      return true;
    });
  }

  /** Lessons staff still have to look at, oldest first. */
  async toReview(user: AuthUser, now = new Date()) {
    const rows = await this.db
      .select({ id: lessons.id })
      .from(lessons)
      .where(
        and(
          isNotNull(lessons.closedAt),
          isNull(lessons.reviewedAt),
          ne(lessons.attendance, 'BOTH'),
          inArray(lessons.status, ['SCHEDULED', 'COMPLETED']),
        ),
      )
      .orderBy(asc(lessons.startsAt))
      .limit(200);
    const views = await this.lessons.viewsByIds(
      user,
      rows.map((r) => r.id),
      now,
    );
    return views.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  }

  /** Staff decide what happened in a lesson that was not attended by both. */
  async review(
    user: AuthUser,
    id: string,
    input: ReviewInput,
    now = new Date(),
  ) {
    await this.db.transaction(async (tx) => {
      const [l] = await tx
        .select()
        .from(lessons)
        .where(eq(lessons.id, id))
        .for('update');
      if (!l) throw new NotFoundException();
      if (!l.closedAt || !l.attendance)
        throw new ConflictException('This lesson has not finished yet.');
      if (l.reviewedAt)
        throw new ConflictException('Someone already checked this lesson.');
      if (l.status !== 'SCHEDULED' && l.status !== 'COMPLETED')
        throw new ConflictException('This lesson did not take place.');
      const allowed = reviewOptions(l.attendance);
      if (!allowed.includes(input.outcome)) {
        throw new BadRequestException(
          `That does not fit what was recorded (${WHO[l.attendance]}).`,
        );
      }

      const stamp = { reviewedAt: now, reviewedById: user.userId };
      if (input.outcome === 'TEACHER_ABSENT') {
        const teacherRemedy = input.teacherRemedy ?? 'CREDIT';
        await this.lessons.cancelInTx(
          tx,
          user,
          id,
          {
            reason: 'BY_TEACHER',
            teacherRemedy,
            note: input.note,
            teacherAbsent: true,
          },
          now,
        );
        await tx.update(lessons).set(stamp).where(eq(lessons.id, id));
      } else {
        const result = reviewResult(input.outcome, l.attendance);
        await tx
          .update(lessons)
          .set({ ...stamp, ...result })
          .where(eq(lessons.id, id));
      }
      const remedy =
        input.outcome === 'TEACHER_ABSENT'
          ? ` · ${(input.teacherRemedy ?? 'CREDIT') === 'MAKEUP' ? 'makeup lesson owed' : 'credit to next invoice'}`
          : '';
      await this.audit.record(tx, user, {
        action: 'lesson.review',
        entityType: 'lesson',
        entityId: id,
        summary: `Checked ${formatInZone(l.startsAt, ACADEMY_TZ)} Cairo · ${OUTCOME_TEXT[input.outcome]}${remedy}`,
        before: { status: l.status, attendance: l.attendance },
        after: { outcome: input.outcome, teacherRemedy: input.teacherRemedy },
        note: input.note,
      });
    });
    return this.lessons.get(user, id, now);
  }
}
