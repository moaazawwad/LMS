import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, count, desc, eq, inArray, ne, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { AuditService } from '../audit/audit.service.js';
import { type AuthUser, actorKindOf, isStaff } from '../common/auth-user.js';
import { RuleViolationException } from '../common/errors.js';
import { DB, type Db, type Tx } from '../db/db.module.js';
import { changeRequests, lessons, users } from '../db/schema.js';
import { LessonNotices } from '../lessons/lesson-notices.js';
import { appUrl, MailService } from '../mail/mail.service.js';
import { newRequestEmail } from '../mail/templates.js';
import { LessonsService } from '../lessons/lessons.service.js';
import { SchedulingService } from '../lessons/scheduling.service.js';
import {
  type RuleViolation,
  teacherCancelCheck,
} from '../rules/lesson-rules.js';
import { ACADEMY_TZ, formatInZone } from '../rules/schedule.js';

/** How far back a lesson can still be asked about (e.g. "please excuse yesterday's lesson"). */
export const REQUEST_LOOKBACK_DAYS = 7;

export type RequestKind = 'CANCEL' | 'RESCHEDULE';

export interface CreateRequestInput {
  lessonId: string;
  kind: RequestKind;
  message: string;
  preferredTimes?: string;
}

export interface ApproveRequestInput {
  /** shown to the requester */
  note?: string;
  /** RESCHEDULE: the new time staff picked */
  startsAt?: Date;
  /** CANCEL asked by a student: true gives a credit even if it was late or over quota */
  credit?: boolean;
  /** CANCEL asked by a teacher */
  teacherRemedy?: 'MAKEUP' | 'CREDIT';
  /**
   * RESCHEDULE: also go past the teacher's hours or a clash at the new time.
   * Approving already accepts the student's notice and quota rules; clashes need this on purpose.
   */
  override?: boolean;
}

@Injectable()
export class RequestsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly lessonsService: LessonsService,
    private readonly scheduling: SchedulingService,
    private readonly audit: AuditService,
    private readonly notices: LessonNotices,
    private readonly mail: MailService,
  ) {}

  async create(user: AuthUser, input: CreateRequestInput, now = new Date()) {
    if (user.role !== 'STUDENT' && user.role !== 'TEACHER') {
      throw new ForbiddenException('Staff change lessons directly.');
    }
    const message = input.message.trim();
    if (!message)
      throw new BadRequestException('Write a short message for the academy.');

    return this.db.transaction(async (tx) => {
      const [lesson] = await tx
        .select()
        .from(lessons)
        .where(eq(lessons.id, input.lessonId));
      const mine =
        lesson &&
        (user.role === 'STUDENT'
          ? lesson.studentId === user.studentId
          : lesson.teacherId === user.teacherId);
      if (!lesson || !mine) throw new NotFoundException('Lesson not found.');
      if (lesson.status !== 'SCHEDULED')
        throw new ConflictException(
          'This lesson was already cancelled or moved.',
        );
      if (
        lesson.startsAt.getTime() <
        now.getTime() - REQUEST_LOOKBACK_DAYS * 86_400_000
      ) {
        throw new ConflictException(
          `Requests can be sent up to ${REQUEST_LOOKBACK_DAYS} days after a lesson.`,
        );
      }
      const [open] = await tx
        .select({ id: changeRequests.id })
        .from(changeRequests)
        .where(
          and(
            eq(changeRequests.lessonId, lesson.id),
            eq(changeRequests.status, 'OPEN'),
          ),
        );
      if (open)
        throw new ConflictException(
          'There is already an open request for this lesson.',
        );
      if (user.role === 'TEACHER' && input.kind === 'CANCEL') {
        const used = await this.lessonsService.teacherCancels(
          tx,
          lesson.teacherId,
          lesson.startsAt,
        );
        if (used.used >= used.limit) {
          throw new RuleViolationException(
            [
              {
                code: 'TEACHER_CANCEL_LIMIT',
                message: `You have used all ${used.limit} cancellations for ${used.month}. Call the academy if you really cannot teach this lesson.`,
              },
            ],
            false,
          );
        }
      }

      const [row] = await tx
        .insert(changeRequests)
        .values({
          lessonId: lesson.id,
          kind: input.kind,
          requestedById: user.userId,
          requesterKind: actorKindOf(user),
          message,
          preferredTimes:
            input.kind === 'RESCHEDULE'
              ? input.preferredTimes?.trim() || null
              : null,
        })
        .returning();
      await this.audit.record(tx, user, {
        action: 'request.create',
        entityType: 'lesson',
        entityId: lesson.id,
        summary: `Asked to ${input.kind === 'CANCEL' ? 'cancel' : 'move'} the lesson on ${formatInZone(lesson.startsAt, ACADEMY_TZ)} Cairo`,
        after: { requestId: row.id, message },
      });
      // Let the academy know: every active admin and staff member.
      const [me] = await tx
        .select({ name: users.fullName })
        .from(users)
        .where(eq(users.id, user.userId));
      const staff = await tx
        .select({ name: users.fullName, email: users.email })
        .from(users)
        .where(
          and(
            inArray(users.role, ['ADMIN', 'STAFF']),
            eq(users.isActive, true),
          ),
        );
      for (const s of staff) {
        await this.mail.enqueue(
          tx,
          s.email,
          'request',
          newRequestEmail({
            name: s.name,
            who: `${me?.name ?? 'Someone'} (${user.role === 'STUDENT' ? 'student' : 'teacher'})`,
            what: input.kind === 'CANCEL' ? 'cancel' : 'move',
            when: formatInZone(lesson.startsAt, ACADEMY_TZ),
            message,
            link: `${appUrl()}/admin/requests`,
          }),
        );
      }
      this.mail.sendSoon();
      return row;
    });
  }

  /** Staff see every request; students and teachers see their own. */
  async list(
    user: AuthUser,
    q: { status?: 'OPEN' | 'CLOSED'; limit?: number },
    now = new Date(),
  ) {
    const where: SQL[] = [];
    if (!isStaff(user))
      where.push(eq(changeRequests.requestedById, user.userId));
    if (q.status === 'OPEN') where.push(eq(changeRequests.status, 'OPEN'));
    if (q.status === 'CLOSED') where.push(ne(changeRequests.status, 'OPEN'));

    const requester = alias(users, 'requester');
    const resolver = alias(users, 'resolver');
    const rows = await this.db
      .select({
        r: changeRequests,
        requesterName: requester.fullName,
        resolverName: resolver.fullName,
      })
      .from(changeRequests)
      .innerJoin(requester, eq(requester.id, changeRequests.requestedById))
      .leftJoin(resolver, eq(resolver.id, changeRequests.resolvedById))
      .where(and(...where))
      .orderBy(desc(changeRequests.createdAt))
      .limit(Math.min(Math.max(q.limit ?? 100, 1), 200));

    const views = await this.lessonsService.viewsByIds(
      user,
      rows.map((x) => x.r.lessonId),
      now,
    );
    const byId = new Map(views.map((v) => [v.id, v]));

    // For open student requests, say which rule stops them doing it online.
    const lessonRows = rows.length
      ? await this.db
          .select()
          .from(lessons)
          .where(
            inArray(
              lessons.id,
              rows.map((x) => x.r.lessonId),
            ),
          )
      : [];
    const lessonById = new Map(lessonRows.map((l) => [l.id, l]));

    return Promise.all(
      rows.map(async ({ r, requesterName, resolverName }) => {
        const lessonRow = lessonById.get(r.lessonId);
        const open =
          isStaff(user) &&
          r.status === 'OPEN' &&
          lessonRow &&
          lessonRow.status === 'SCHEDULED';
        let rules: RuleViolation[] = [];
        if (open && r.requesterKind === 'STUDENT') {
          rules = await this.lessonsService.studentChangeViolations(
            this.db,
            lessonRow,
            r.kind === 'CANCEL' ? 'cancel' : 'reschedule',
            now,
          );
        } else if (open && r.kind === 'CANCEL') {
          const used = await this.lessonsService.teacherCancels(
            this.db,
            lessonRow.teacherId,
            lessonRow.startsAt,
          );
          rules = teacherCancelCheck(used.used, used.month);
        }
        return {
          id: r.id,
          kind: r.kind,
          status: r.status,
          message: r.message,
          preferredTimes: r.preferredTimes,
          createdAt: r.createdAt,
          requester: { name: requesterName, kind: r.requesterKind },
          resolvedAt: r.resolvedAt,
          resolvedBy: resolverName,
          resolutionNote: r.resolutionNote,
          resultLessonId: r.resultLessonId,
          lesson: byId.get(r.lessonId) ?? null,
          /** what would stop the student doing it online now: staff approving it go past these */
          rules,
        };
      }),
    );
  }

  async openCount(user: AuthUser) {
    const where = [eq(changeRequests.status, 'OPEN')];
    if (!isStaff(user))
      where.push(eq(changeRequests.requestedById, user.userId));
    const [row] = await this.db
      .select({ n: count() })
      .from(changeRequests)
      .where(and(...where));
    return { open: row?.n ?? 0 };
  }

  async approve(
    user: AuthUser,
    id: string,
    input: ApproveRequestInput,
    now = new Date(),
  ) {
    if (!isStaff(user)) throw new ForbiddenException();
    return this.db.transaction(async (tx) => {
      const req = await this.lockOpen(tx, id);
      const fromStudent = req.requesterKind === 'STUDENT';
      const adminNote = input.note?.trim() || null;
      const logNote = `Approved ${fromStudent ? 'the student' : 'the teacher'}'s request${adminNote ? `: ${adminNote}` : ''}`;
      let resultLessonId: string | null = null;
      let outcome: string;

      if (req.kind === 'RESCHEDULE') {
        if (!input.startsAt)
          throw new BadRequestException('Pick the new time.');
        const [lesson] = await tx
          .select()
          .from(lessons)
          .where(eq(lessons.id, req.lessonId));
        const clashes = await this.scheduling.checkSlot(tx, {
          teacherId: lesson.teacherId,
          studentId: lesson.studentId,
          startsAt: input.startsAt,
          durationMin: lesson.durationMin,
          excludeLessonId: lesson.id,
        });
        if (clashes.length && !input.override)
          throw new RuleViolationException(clashes, true);
        const moved = await this.lessonsService.rescheduleInTx(
          tx,
          user,
          req.lessonId,
          {
            startsAt: input.startsAt,
            requestedBy: fromStudent ? 'STUDENT' : 'TEACHER',
            override: true,
            note: logNote,
          },
          now,
        );
        resultLessonId = moved.id;
        outcome = `moved to ${formatInZone(moved.startsAt, ACADEMY_TZ)} Cairo`;
      } else if (fromStudent) {
        const res = await this.lessonsService.cancelInTx(
          tx,
          user,
          req.lessonId,
          { reason: 'BY_STUDENT', override: !!input.credit, note: logNote },
          now,
        );
        outcome = res.outcome.credit
          ? 'cancelled with a credit'
          : 'cancelled, counts as taken';
      } else {
        const remedy = input.teacherRemedy ?? 'CREDIT';
        // Past the teacher's monthly limit only with an override (the log names the rule).
        await this.lessonsService.cancelInTx(
          tx,
          user,
          req.lessonId,
          {
            reason: 'BY_TEACHER',
            teacherRemedy: remedy,
            note: logNote,
            override: input.override,
          },
          now,
        );
        outcome =
          remedy === 'MAKEUP'
            ? 'cancelled, makeup owed'
            : 'cancelled with a credit';
      }

      const [row] = await tx
        .update(changeRequests)
        .set({
          status: 'APPROVED',
          resolvedById: user.userId,
          resolvedAt: now,
          resolutionNote: adminNote,
          resultLessonId,
        })
        .where(eq(changeRequests.id, id))
        .returning();
      await this.audit.record(tx, user, {
        action: 'request.approve',
        entityType: 'lesson',
        entityId: req.lessonId,
        summary: `Approved a request to ${req.kind === 'CANCEL' ? 'cancel' : 'move'}: ${outcome}`,
        after: { requestId: id, resultLessonId },
        note: adminNote ?? undefined,
      });
      return row;
    });
  }

  async decline(user: AuthUser, id: string, note: string, now = new Date()) {
    if (!isStaff(user)) throw new ForbiddenException();
    const reason = note.trim();
    if (!reason)
      throw new BadRequestException('Say why, so the requester knows.');
    return this.db.transaction(async (tx) => {
      const req = await this.lockOpen(tx, id);
      const [row] = await tx
        .update(changeRequests)
        .set({
          status: 'DECLINED',
          resolvedById: user.userId,
          resolvedAt: now,
          resolutionNote: reason,
        })
        .where(eq(changeRequests.id, id))
        .returning();
      await this.audit.record(tx, user, {
        action: 'request.decline',
        entityType: 'lesson',
        entityId: req.lessonId,
        summary: `Declined a request to ${req.kind === 'CANCEL' ? 'cancel' : 'move'} the lesson`,
        after: { requestId: id },
        note: reason,
      });
      await this.notices.send(
        tx,
        user,
        req.lessonId,
        {
          kind: 'declined',
          requestKind: req.kind,
          reply: reason,
          requesterUserId: req.requestedById,
        },
        now,
      );
      return row;
    });
  }

  async withdraw(user: AuthUser, id: string, now = new Date()) {
    return this.db.transaction(async (tx) => {
      const [own] = await tx
        .select({ by: changeRequests.requestedById })
        .from(changeRequests)
        .where(eq(changeRequests.id, id));
      if (!own || own.by !== user.userId)
        throw new NotFoundException('Request not found.');
      const req = await this.lockOpen(tx, id);
      const [row] = await tx
        .update(changeRequests)
        .set({
          status: 'WITHDRAWN',
          resolvedById: user.userId,
          resolvedAt: now,
        })
        .where(eq(changeRequests.id, id))
        .returning();
      await this.audit.record(tx, user, {
        action: 'request.withdraw',
        entityType: 'lesson',
        entityId: req.lessonId,
        summary: `Withdrew the request to ${req.kind === 'CANCEL' ? 'cancel' : 'move'} the lesson`,
        after: { requestId: id },
      });
      return row;
    });
  }

  private async lockOpen(tx: Tx, id: string) {
    const [req] = await tx
      .select()
      .from(changeRequests)
      .where(eq(changeRequests.id, id))
      .for('update');
    if (!req) throw new NotFoundException('Request not found.');
    if (req.status !== 'OPEN')
      throw new ConflictException(
        `This request was already ${req.status.toLowerCase()}.`,
      );
    return req;
  }
}
