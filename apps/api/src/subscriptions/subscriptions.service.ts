import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, gt, gte, inArray, ne } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { CyclesService } from '../billing/cycles.service.js';
import { type AuthUser, actorKindOf } from '../common/auth-user.js';
import { type OverrideInput, resolveViolations } from '../common/override.js';
import { DB, type Db, type Tx } from '../db/db.module.js';
import {
  billingCycles,
  curricula,
  invoices,
  lessonCharges,
  lessonCredits,
  lessons,
  type LessonType,
  plans,
  students,
  subscriptions,
  teacherCurricula,
  teachers,
  users,
  weeklySlots,
} from '../db/schema.js';
import { LessonsService } from '../lessons/lessons.service.js';
import { SchedulingService } from '../lessons/scheduling.service.js';
import {
  cycleRange,
  hoursPerCycleFor,
  planForLessons,
} from '../rules/billing.js';
import {
  type RuleViolation,
  teacherLevelCheck,
} from '../rules/lesson-rules.js';
import {
  ACADEMY_TZ,
  formatInZone,
  localDateOf,
  occurrencesInRange,
  parseHHmm,
  type SlotRule,
} from '../rules/schedule.js';
import { teacherName } from '../common/names.js';

export interface CreateSubscriptionInput extends OverrideInput {
  studentId: string;
  teacherId: string;
  curriculumId: string;
  /** optional: the plan follows the lessons a week; when given it must be that plan */
  planId?: string;
  /** optional: the number of weekly times; when given it must match */
  lessonsPerWeek?: number;
  /** first day of cycle 1, the student's local date */
  startDate: string;
  slots: SlotRule[];
}

export interface UpdateSubscriptionInput extends OverrideInput {
  planId?: string;
  lessonsPerWeek?: number;
  slots?: SlotRule[];
  /** move the upcoming lessons of the current cycle to the new times now (default: from the next cycle) */
  applyNow?: boolean;
}

@Injectable()
export class SubscriptionsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly cycles: CyclesService,
    private readonly scheduling: SchedulingService,
    private readonly lessonsService: LessonsService,
  ) {}

  async create(user: AuthUser, input: CreateSubscriptionInput) {
    return this.db.transaction(async (tx) => {
      const [student] = await tx
        .select({
          id: students.id,
          status: students.status,
          timezone: users.timezone,
          name: users.fullName,
        })
        .from(students)
        .innerJoin(users, eq(users.id, students.userId))
        .where(eq(students.id, input.studentId));
      if (!student) throw new NotFoundException('Student not found');
      const [teacher] = await tx
        .select()
        .from(teachers)
        .where(eq(teachers.id, input.teacherId));
      if (!teacher || teacher.status !== 'ACTIVE')
        throw new BadRequestException('Unknown or inactive teacher.');
      const lessonsPerWeek = input.lessonsPerWeek ?? input.slots.length;
      this.validateSlots(lessonsPerWeek, input.slots);
      const plan = await this.planFor(tx, lessonsPerWeek, input.planId);
      const [curriculum] = await tx
        .select()
        .from(curricula)
        .where(eq(curricula.id, input.curriculumId));
      if (!curriculum) throw new BadRequestException('Unknown curriculum.');

      const violations: RuleViolation[] = [];
      if (teacherLevelCheck(teacher.level, plan.tier) === 'LOWER') {
        violations.push({
          code: 'TEACHER_LEVEL_TOO_LOW',
          message: `A ${teacher.level.toLowerCase()} teacher for a ${plan.tier.toLowerCase()} plan.`,
        });
      }
      if (
        !(await this.scheduling.teachesCurriculum(
          tx,
          teacher.id,
          curriculum.id,
        ))
      ) {
        violations.push({
          code: 'CURRICULUM_NOT_TAUGHT',
          message: 'The teacher does not teach this curriculum.',
        });
      }
      // Check every lesson of the first cycle (it may cross a clock change).
      const first = cycleRange(input.startDate, 1);
      const times = occurrencesInRange({
        timezone: student.timezone,
        slots: input.slots,
        fromDate: first.startDate,
        toDate: first.endDate,
      });
      const windows = await this.scheduling.teacherWindows(tx, teacher.id);
      for (const startsAt of times) {
        const found = await this.scheduling.checkSlot(tx, {
          teacherId: teacher.id,
          studentId: student.id,
          startsAt,
          durationMin: plan.lessonMinutes,
          windows,
        });
        const at = `${formatInZone(startsAt, ACADEMY_TZ)} Cairo`;
        for (const v of found)
          violations.push({ ...v, at, message: `${at}: ${v.message}` });
      }
      const override = resolveViolations(user, violations, input);

      const [sub] = await tx
        .insert(subscriptions)
        .values({
          studentId: student.id,
          teacherId: teacher.id,
          curriculumId: curriculum.id,
          planId: plan.id,
          lessonsPerWeek,
          timezone: student.timezone,
          startDate: input.startDate,
        })
        .returning();
      await tx
        .insert(weeklySlots)
        .values(input.slots.map((s) => ({ ...s, subscriptionId: sub.id })));
      if (student.status !== 'ACTIVE')
        await tx
          .update(students)
          .set({ status: 'ACTIVE' })
          .where(eq(students.id, student.id));

      await this.audit.record(tx, user, {
        action: 'subscription.create',
        entityType: 'subscription',
        entityId: sub.id,
        summary: `${student.name}: ${plan.name}, ${lessonsPerWeek}/week from ${input.startDate}`,
        after: { ...sub, slots: input.slots },
        override,
        note: input.note,
      });
      const cycle = await this.cycles.createCycle(tx, sub.id, 1, user);
      return {
        id: sub.id,
        cycleId: cycle.cycle.id,
        invoiceId: cycle.invoice.id,
        lessonsCreated: cycle.lessonsCreated,
      };
    });
  }

  async get(id: string) {
    const sub = await this.db.query.subscriptions.findFirst({
      where: eq(subscriptions.id, id),
      with: {
        plan: true,
        curriculum: true,
        slots: {
          orderBy: [asc(weeklySlots.weekday), asc(weeklySlots.startTime)],
        },
        cycles: {
          orderBy: [asc(billingCycles.index)],
          with: { invoices: { orderBy: [desc(invoices.issuedAt)] } },
        },
        teacher: { with: { user: { columns: { fullName: true } } } },
        student: { with: { user: { columns: { fullName: true } } } },
      },
    });
    if (!sub) throw new NotFoundException();
    // Each cycle shows its live invoice; a void one only when nothing replaced it.
    const cycles = sub.cycles.map(({ invoices: list, ...c }) => ({
      ...c,
      invoice: list.find((i) => i.status !== 'VOID') ?? list[0] ?? null,
    }));
    return { ...sub, cycles };
  }

  /**
   * Plan changes apply now (quota and the next invoice).
   * Frequency and weekly slots shape the lessons of the NEXT cycle; lessons
   * already created this cycle stay as they are.
   */
  async update(
    user: AuthUser,
    id: string,
    input: UpdateSubscriptionInput,
    now = new Date(),
  ) {
    return this.db.transaction(async (tx) => {
      const sub = await tx.query.subscriptions.findFirst({
        where: eq(subscriptions.id, id),
        with: {
          slots: true,
          teacher: true,
          plan: true,
          student: { with: { user: { columns: { fullName: true } } } },
        },
      });
      if (!sub) throw new NotFoundException();

      const violations: RuleViolation[] = [];
      // The plan follows the lessons a week: more lessons can move it up a step.
      const lessonsPerWeek =
        input.lessonsPerWeek ?? input.slots?.length ?? sub.lessonsPerWeek;
      const plan =
        lessonsPerWeek !== sub.lessonsPerWeek || input.planId
          ? await this.planFor(tx, lessonsPerWeek, input.planId)
          : sub.plan;
      const planChanges = plan.id !== sub.planId;
      if (
        planChanges &&
        teacherLevelCheck(sub.teacher.level, plan.tier) === 'LOWER'
      ) {
        violations.push({
          code: 'TEACHER_LEVEL_TOO_LOW',
          message: `${lessonsPerWeek} lessons a week is the ${plan.name} plan; the current teacher is below the ${plan.tier.toLowerCase()} level.`,
        });
      }
      const slots =
        input.slots ??
        sub.slots.map(({ weekday, startTime }) => ({ weekday, startTime }));
      if (
        planChanges ||
        input.lessonsPerWeek !== undefined ||
        input.slots !== undefined
      )
        this.validateSlots(lessonsPerWeek, slots);
      // Now: the old upcoming lessons step aside first, so the new times are
      // checked against everything else (the teacher's hours and other lessons).
      const moving =
        input.applyNow && input.slots
          ? await this.prepareMove(tx, sub, slots, plan.lessonMinutes, now)
          : null;
      if (moving) violations.push(...moving.violations);
      const override = resolveViolations(user, violations, input);

      await tx
        .update(subscriptions)
        .set({ planId: plan.id, lessonsPerWeek })
        .where(eq(subscriptions.id, id));
      const moved = moving
        ? await this.finishMove(tx, user, sub, moving, plan.lessonMinutes, now)
        : null;
      if (input.slots) {
        await tx.delete(weeklySlots).where(eq(weeklySlots.subscriptionId, id));
        await tx
          .insert(weeklySlots)
          .values(slots.map((s) => ({ ...s, subscriptionId: id })));
      }
      await this.audit.record(tx, user, {
        action: 'subscription.update',
        entityType: 'subscription',
        entityId: id,
        summary: updateSummary({
          name: sub.student.user.fullName,
          planBefore: sub.plan.name,
          planAfter: plan.name,
          slotsBefore: sub.slots,
          slotsAfter: input.slots ? slots : null,
          timezone: sub.timezone,
          moved,
        }),
        before: {
          planId: sub.planId,
          lessonsPerWeek: sub.lessonsPerWeek,
          slots: sub.slots.map(({ weekday, startTime }) => ({
            weekday,
            startTime,
          })),
        },
        after: { planId: plan.id, lessonsPerWeek, slots, moved },
        override,
        note: input.note,
      });
      return { id, moved };
    });
  }

  /**
   * For picking a new teacher: every active teacher of the curriculum, with
   * how many upcoming lessons would break a rule with them, by reason.
   */
  async transferOptions(id: string, now = new Date()) {
    const sub = await this.db.query.subscriptions.findFirst({
      where: eq(subscriptions.id, id),
    });
    if (!sub) throw new NotFoundException();
    const upcoming = await this.db
      .select()
      .from(lessons)
      .where(
        and(
          eq(lessons.subscriptionId, id),
          eq(lessons.status, 'SCHEDULED'),
          gt(lessons.startsAt, now),
        ),
      )
      .orderBy(asc(lessons.startsAt));
    const candidates = await this.db
      .select({
        id: teachers.id,
        name: users.fullName,
        level: teachers.level,
      })
      .from(teachers)
      .innerJoin(users, eq(users.id, teachers.userId))
      .innerJoin(
        teacherCurricula,
        and(
          eq(teacherCurricula.teacherId, teachers.id),
          eq(teacherCurricula.curriculumId, sub.curriculumId),
        ),
      )
      .where(and(eq(teachers.status, 'ACTIVE'), ne(teachers.id, sub.teacherId)))
      .orderBy(asc(users.fullName));
    const out = [];
    for (const t of candidates) {
      let outsideHours = 0;
      let busy = 0;
      let levelTooLow = false;
      for (const lesson of upcoming) {
        const found = await this.lessonsService.teacherChangeViolations(
          this.db,
          lesson,
          t.id,
          now,
        );
        if (found.some((v) => v.code === 'TEACHER_UNAVAILABLE')) outsideHours++;
        if (found.some((v) => v.code === 'TIME_CONFLICT')) busy++;
        if (found.some((v) => v.code === 'TEACHER_LEVEL_TOO_LOW'))
          levelTooLow = true;
      }
      out.push({
        teacherId: t.id,
        name: t.name,
        level: t.level,
        lessons: upcoming.length,
        /** lessons outside the teacher's hours */
        outsideHours,
        /** lessons that clash with the teacher's other lessons */
        busy,
        levelTooLow,
      });
    }
    return out;
  }

  /** Move every upcoming lesson of a subscription to another teacher. */
  async transfer(
    user: AuthUser,
    id: string,
    input: OverrideInput & { teacherId: string },
    now = new Date(),
  ) {
    return this.db.transaction(async (tx) => {
      const [sub] = await tx
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, id))
        .for('update');
      if (!sub) throw new NotFoundException();
      if (sub.teacherId === input.teacherId)
        throw new BadRequestException('That is already the teacher.');
      const upcoming = await tx
        .select()
        .from(lessons)
        .where(
          and(
            eq(lessons.subscriptionId, id),
            eq(lessons.status, 'SCHEDULED'),
            gt(lessons.startsAt, now),
          ),
        )
        .orderBy(asc(lessons.startsAt));

      const violations: RuleViolation[] = [];
      for (const lesson of upcoming) {
        const found = await this.lessonsService.teacherChangeViolations(
          tx,
          lesson,
          input.teacherId,
          now,
        );
        for (const v of found) {
          const at = `${formatInZone(lesson.startsAt, ACADEMY_TZ)} Cairo`;
          const message = `${at}: ${v.message}`;
          if (!violations.some((x) => x.message === message))
            violations.push({ ...v, at, message });
        }
      }
      const override = resolveViolations(user, violations, input);

      for (const lesson of upcoming) {
        await tx
          .update(lessons)
          .set({ status: 'RESCHEDULED' })
          .where(eq(lessons.id, lesson.id));
        await tx.insert(lessons).values({
          subscriptionId: lesson.subscriptionId,
          cycleId: lesson.cycleId,
          studentId: lesson.studentId,
          teacherId: input.teacherId,
          curriculumId: lesson.curriculumId,
          startsAt: lesson.startsAt,
          durationMin: lesson.durationMin,
          type: 'TRANSFERRED',
          originLessonId: lesson.id,
        });
      }
      await tx
        .update(subscriptions)
        .set({ teacherId: input.teacherId })
        .where(eq(subscriptions.id, id));
      await this.audit.record(tx, user, {
        action: 'subscription.transfer',
        entityType: 'subscription',
        entityId: id,
        summary: `Moved ${upcoming.length} upcoming lessons from ${await teacherName(tx, sub.teacherId)} to ${await teacherName(tx, input.teacherId)}`,
        before: { teacherId: sub.teacherId },
        after: { teacherId: input.teacherId, lessonsMoved: upcoming.length },
        override,
        note: input.note,
      });
      return { lessonsMoved: upcoming.length };
    });
  }

  /**
   * Pause: no new cycles, and the prepaid lessons still ahead are cancelled
   * by the academy with a credit that waits until the student returns.
   * Returning = a new subscription (its first lesson is marked RETURNING).
   */
  async pause(
    user: AuthUser,
    id: string,
    note: string | undefined,
    now = new Date(),
  ) {
    return this.db.transaction(async (tx) => {
      const [sub] = await tx
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, id))
        .for('update');
      if (!sub) throw new NotFoundException();
      if (sub.status !== 'ACTIVE')
        throw new ConflictException('Only active subscriptions can be paused.');
      const upcoming = await tx
        .select({ id: lessons.id })
        .from(lessons)
        .where(
          and(
            eq(lessons.subscriptionId, id),
            eq(lessons.status, 'SCHEDULED'),
            gt(lessons.startsAt, now),
          ),
        );
      for (const l of upcoming) {
        await tx
          .update(lessons)
          .set({
            status: 'CANCELLED',
            cancelReason: 'BY_ADMIN',
            cancelledBy: 'ADMIN',
            cancelledAt: now,
          })
          .where(eq(lessons.id, l.id));
        await tx
          .insert(lessonCredits)
          .values({ studentId: sub.studentId, lessonId: l.id });
      }
      await tx
        .update(subscriptions)
        .set({ status: 'PAUSED' })
        .where(eq(subscriptions.id, id));
      const [other] = await tx
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.studentId, sub.studentId),
            eq(subscriptions.status, 'ACTIVE'),
            ne(subscriptions.id, id),
          ),
        );
      if (!other)
        await tx
          .update(students)
          .set({ status: 'PAUSED' })
          .where(eq(students.id, sub.studentId));
      await this.audit.record(tx, user, {
        action: 'subscription.pause',
        entityType: 'subscription',
        entityId: id,
        summary: `Paused · ${upcoming.length} upcoming lessons cancelled with credit`,
        before: { status: 'ACTIVE' },
        after: { status: 'PAUSED', credits: upcoming.length },
        note,
      });
      return { lessonsCancelled: upcoming.length };
    });
  }

  async invoicesFor(subscriptionId: string) {
    return this.db
      .select({ invoice: invoices })
      .from(invoices)
      .innerJoin(billingCycles, eq(billingCycles.id, invoices.cycleId))
      .where(eq(billingCycles.subscriptionId, subscriptionId));
  }

  /** The lessons a week a plan gives; a number sent along must agree with it. */
  /**
   * Step 1 of changing times now: every cycle still running (or not started)
   * puts its upcoming regular lessons aside and works out the new times,
   * with any rule they break.
   */
  private async prepareMove(
    tx: Tx,
    sub: { id: string; teacherId: string; studentId: string; timezone: string },
    slots: SlotRule[],
    durationMin: number,
    now: Date,
  ) {
    const today = localDateOf(now, sub.timezone);
    const cycles = await tx
      .select()
      .from(billingCycles)
      .where(
        and(
          eq(billingCycles.subscriptionId, sub.id),
          gte(billingCycles.endDate, today),
        ),
      )
      .orderBy(asc(billingCycles.index));
    const plan: {
      cycle: (typeof cycles)[number];
      old: (typeof lessons.$inferSelect)[];
      times: Date[];
    }[] = [];
    for (const cycle of cycles) {
      const old = await tx
        .select()
        .from(lessons)
        .where(
          and(
            eq(lessons.cycleId, cycle.id),
            eq(lessons.status, 'SCHEDULED'),
            ne(lessons.type, 'EXTRA'),
            gt(lessons.startsAt, now),
          ),
        )
        .orderBy(asc(lessons.startsAt));
      if (old.length)
        await tx
          .update(lessons)
          .set({ status: 'RESCHEDULED' })
          .where(
            inArray(
              lessons.id,
              old.map((l) => l.id),
            ),
          );
      const times = occurrencesInRange({
        timezone: sub.timezone,
        slots,
        fromDate: cycle.startDate > today ? cycle.startDate : today,
        toDate: cycle.endDate,
      }).filter((t) => t.getTime() > now.getTime());
      plan.push({ cycle, old, times });
    }
    const violations: RuleViolation[] = [];
    const windows = await this.scheduling.teacherWindows(tx, sub.teacherId);
    for (const { times } of plan)
      for (const startsAt of times) {
        const found = await this.scheduling.checkSlot(tx, {
          teacherId: sub.teacherId,
          studentId: sub.studentId,
          startsAt,
          durationMin,
          windows,
        });
        for (const v of found) {
          const at = `${formatInZone(startsAt, ACADEMY_TZ)} Cairo`;
          violations.push({ ...v, at, message: `${at}: ${v.message}` });
        }
      }
    return { cycles: plan, violations };
  }

  /**
   * Step 2: book the new times. Fewer lessons than before: the ones dropped
   * are cancelled with a credit. More: the added ones are extra lessons at the
   * plan price. Either goes on the cycle's invoice while it is unpaid, else
   * on the next one.
   */
  private async finishMove(
    tx: Tx,
    user: AuthUser,
    sub: {
      id: string;
      teacherId: string;
      studentId: string;
      curriculumId: string;
    },
    moving: Awaited<ReturnType<SubscriptionsService['prepareMove']>>,
    durationMin: number,
    now: Date,
  ) {
    let movedCount = 0;
    let added = 0;
    let dropped = 0;
    const invoicesTouched = new Set<string>();
    for (const { cycle, old, times } of moving.cycles) {
      const extra = Math.max(0, times.length - old.length);
      const drop = Math.max(0, old.length - times.length);
      movedCount += Math.min(old.length, times.length);
      added += extra;
      dropped += drop;
      const created = times.length
        ? await tx
            .insert(lessons)
            .values(
              times.map((startsAt, i) => ({
                subscriptionId: sub.id,
                cycleId: cycle.id,
                studentId: sub.studentId,
                teacherId: sub.teacherId,
                curriculumId: sub.curriculumId,
                startsAt,
                durationMin,
                // keeps what the old lesson was (first lesson, transferred...)
                type: (old[i]?.type ?? 'REGULAR') as LessonType,
              })),
            )
            .returning()
        : [];
      const [open] = await tx
        .select()
        .from(invoices)
        .where(and(eq(invoices.cycleId, cycle.id), eq(invoices.status, 'OPEN')))
        .for('update');
      // Dropped lessons: cancelled, with a credit.
      for (const lesson of old.slice(old.length - drop)) {
        await tx
          .update(lessons)
          .set({
            status: 'CANCELLED',
            cancelReason: 'BY_ADMIN',
            cancelledBy: actorKindOf(user),
            cancelledAt: now,
          })
          .where(eq(lessons.id, lesson.id));
        await tx.insert(lessonCredits).values({
          studentId: sub.studentId,
          lessonId: lesson.id,
          ...(open ? { status: 'APPLIED' as const, invoiceId: open.id } : {}),
        });
      }
      // Added lessons (the last ones beyond the old count): charged like extra lessons.
      for (const lesson of created.slice(created.length - extra))
        await tx.insert(lessonCharges).values({
          studentId: sub.studentId,
          lessonId: lesson.id,
          ...(open ? { status: 'APPLIED' as const, invoiceId: open.id } : {}),
        });
      if (open && (extra || drop)) {
        const credits = Math.min(drop, open.billedLessons + extra);
        await tx
          .update(invoices)
          .set({
            extraCount: open.extraCount + extra,
            creditsCount: open.creditsCount + credits,
            billedLessons: open.billedLessons + extra - credits,
            totalCents: open.totalCents + (extra - credits) * open.priceCents,
          })
          .where(eq(invoices.id, open.id));
        invoicesTouched.add(open.number);
      }
    }
    return {
      moved: movedCount,
      added,
      dropped,
      invoices: [...invoicesTouched],
    };
  }

  /**
   * The active plan for this many lessons a week (see planForLessons). When the
   * caller names a plan it has to be that one.
   */
  private async planFor(tx: Tx, lessonsPerWeek: number, asked?: string) {
    const active = await tx
      .select()
      .from(plans)
      .where(eq(plans.isActive, true));
    const plan = planForLessons(active, lessonsPerWeek);
    if (!plan)
      throw new BadRequestException(
        'There is no active plan. Add one under Curricula & plans.',
      );
    if (asked && asked !== plan.id) {
      const hours = hoursPerCycleFor(lessonsPerWeek, plan.lessonMinutes);
      throw new BadRequestException(
        `${lessonsPerWeek} lesson(s) a week is ${hours} hours a cycle: that is the ${plan.name} plan. Change the weekly times to change the plan.`,
      );
    }
    return plan;
  }

  private validateSlots(lessonsPerWeek: number, slots: SlotRule[]) {
    if (
      !Number.isInteger(lessonsPerWeek) ||
      lessonsPerWeek < 1 ||
      lessonsPerWeek > 7
    ) {
      throw new BadRequestException(
        'Lessons per week must be between 1 and 7.',
      );
    }
    if (slots.length !== lessonsPerWeek) {
      throw new BadRequestException(
        `Give exactly ${lessonsPerWeek} weekly time(s) for ${lessonsPerWeek} lesson(s) a week.`,
      );
    }
    const seen = new Set<string>();
    for (const s of slots) {
      if (!Number.isInteger(s.weekday) || s.weekday < 1 || s.weekday > 7)
        throw new BadRequestException('Weekday must be 1-7.');
      parseHHmm(s.startTime);
      const key = `${s.weekday}-${s.startTime}`;
      if (seen.has(key))
        throw new BadRequestException('Two slots at the same time.');
      seen.add(key);
    }
  }
}

/** "Omar: weekly times Tue 17:00, Thu 17:00 → Mon 18:00, Wed 18:00 · plan Standard → Premium · now: 6 lessons moved, 2 added (INV-0007)" */
function updateSummary(x: {
  name: string;
  planBefore: string;
  planAfter: string;
  slotsBefore: SlotRule[];
  slotsAfter: SlotRule[] | null;
  timezone: string;
  moved: {
    moved: number;
    added: number;
    dropped: number;
    invoices: string[];
  } | null;
}) {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const list = (slots: SlotRule[]) =>
    [...slots]
      .sort(
        (a, b) =>
          a.weekday - b.weekday || a.startTime.localeCompare(b.startTime),
      )
      .map((s) => `${days[s.weekday - 1]} ${s.startTime}`)
      .join(', ');
  const parts: string[] = [];
  if (x.slotsAfter && list(x.slotsAfter) !== list(x.slotsBefore))
    parts.push(
      `weekly times ${list(x.slotsBefore)} → ${list(x.slotsAfter)} (${x.timezone})`,
    );
  if (x.planBefore !== x.planAfter)
    parts.push(`plan ${x.planBefore} → ${x.planAfter}`);
  if (x.moved) {
    const bits = [`${x.moved.moved} upcoming lessons moved`];
    if (x.moved.added) bits.push(`${x.moved.added} added as extra`);
    if (x.moved.dropped) bits.push(`${x.moved.dropped} cancelled with credit`);
    const where = x.moved.invoices.length
      ? ` (${x.moved.invoices.join(', ')})`
      : '';
    parts.push(`from now: ${bits.join(', ')}${where}`);
  } else if (x.slotsAfter) parts.push('from the next cycle');
  return `${x.name}: ${parts.length ? parts.join(' · ') : 'no change'}`;
}
