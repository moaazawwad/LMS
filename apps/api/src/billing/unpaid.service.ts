import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  and,
  asc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  lte,
  ne,
  sql,
} from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { DB, type Db, type Executor, type Tx } from '../db/db.module.js';
import {
  billingCycles,
  invoices,
  lessonCredits,
  lessons,
  students,
  subscriptions,
  teachers,
  users,
} from '../db/schema.js';
import { appUrl, MailService } from '../mail/mail.service.js';
import { noticeEmail } from '../mail/templates.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import {
  countsAsTaken,
  UNPAID_GRACE_LESSONS,
  unpaidStep,
} from '../rules/billing.js';
import { localDateOf, overlaps } from '../rules/schedule.js';

/** Tell the student about an unpaid invoice this long before a lesson. */
export const WARN_BEFORE_MIN = 60;

type Invoice = typeof invoices.$inferSelect;
type Cycle = typeof billingCycles.$inferSelect;
type Subscription = typeof subscriptions.$inferSelect;

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(
    cents / 100,
  );

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * What happens to an invoice nobody paid.
 *
 * An invoice is prepaid for its 28-day cycle. The student is told at the last
 * lesson of the cycle before, then with each of the first two lessons of the
 * unpaid cycle. After the second lesson (or when the cycle ends) the rest of
 * the cycle's lessons are removed and the subscription waits (PAUSED, with
 * `heldForInvoiceId`). Paying the invoice brings the lessons back: the ones
 * still ahead are restored when the teacher is still free, the others become
 * credits on the next invoice, so the family gets what it paid for.
 */
@Injectable()
export class UnpaidService {
  private readonly log = new Logger('Unpaid');

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly notices: NotificationsService,
  ) {}

  /** The cycle's lessons that matter for the grace count, oldest first. */
  private cycleLessons(exec: Executor, cycleId: string) {
    return exec
      .select({
        id: lessons.id,
        startsAt: lessons.startsAt,
        durationMin: lessons.durationMin,
        status: lessons.status,
        countedAsTaken: lessons.countedAsTaken,
        extraReason: lessons.extraReason,
        cancelReason: lessons.cancelReason,
      })
      .from(lessons)
      .where(eq(lessons.cycleId, cycleId))
      .orderBy(asc(lessons.startsAt));
  }

  private async studentUser(exec: Executor, studentId: string) {
    const [row] = await exec
      .select({
        userId: users.id,
        name: users.fullName,
        email: users.email,
      })
      .from(students)
      .innerJoin(users, eq(users.id, students.userId))
      .where(eq(students.id, studentId));
    return row;
  }

  private async teacherUserId(exec: Executor, teacherId: string) {
    const [row] = await exec
      .select({ userId: teachers.userId })
      .from(teachers)
      .where(eq(teachers.id, teacherId));
    return row?.userId;
  }

  /**
   * Every 5 minutes: warn before the grace lessons, stop the lessons of
   * invoices that ran out of grace, and give the heads-up at the last lesson
   * of a cycle.
   */
  @Cron('*/5 * * * *')
  async check(now: Date = new Date()) {
    const open = await this.db
      .select({ invoice: invoices, cycle: billingCycles, sub: subscriptions })
      .from(invoices)
      .innerJoin(billingCycles, eq(billingCycles.id, invoices.cycleId))
      .innerJoin(
        subscriptions,
        eq(subscriptions.id, billingCycles.subscriptionId),
      )
      .where(
        and(
          eq(invoices.status, 'OPEN'),
          gt(invoices.totalCents, 0),
          eq(subscriptions.status, 'ACTIVE'),
        ),
      );
    let warned = 0;
    let held = 0;
    for (const row of open) {
      try {
        const cycleLessons = await this.cycleLessons(this.db, row.cycle.id);
        const taken = cycleLessons.filter((l) => countsAsTaken(l, now)).length;
        const step = unpaidStep({
          status: row.invoice.status,
          totalCents: row.invoice.totalCents,
          lessonsTaken: taken,
          cycleEnded: localDateOf(now, row.sub.timezone) > row.cycle.endDate,
        });
        if (step.step === 'HOLD') {
          if (await this.hold(row.invoice.id, now)) held++;
          continue;
        }
        if (step.step !== 'GRACE') continue;
        const next = cycleLessons.find(
          (l) =>
            l.status === 'SCHEDULED' &&
            l.extraReason !== 'MAKEUP' &&
            l.startsAt > now,
        );
        if (
          !next ||
          next.startsAt.getTime() - now.getTime() > WARN_BEFORE_MIN * 60_000
        )
          continue;
        // Which of the grace lessons this one is, counting one still running.
        const lessonNo =
          cycleLessons.filter(
            (l) =>
              l.startsAt < next.startsAt &&
              l.extraReason !== 'MAKEUP' &&
              (countsAsTaken(l, now) || l.status === 'SCHEDULED'),
          ).length + 1;
        if (lessonNo > UNPAID_GRACE_LESSONS) continue;
        if (await this.warn(row.invoice, lessonNo)) warned++;
      } catch (err) {
        this.log.warn(
          `Invoice ${row.invoice.number}: ${(err as Error).message}`,
        );
      }
    }
    const headsUp = await this.renewalHeadsUp(now);
    if (warned || held || headsUp) {
      this.log.log(
        `Unpaid invoices: ${warned} warned, ${held} put on hold, ${headsUp} renewal notices`,
      );
      this.mail.sendSoon();
    }
    return { warned, held, headsUp };
  }

  /** "This lesson is 1 of 2 before paying": once per invoice and lesson number. */
  private async warn(invoice: Invoice, lessonNo: number): Promise<boolean> {
    const total = money(invoice.totalCents, invoice.currency);
    const last = lessonNo >= UNPAID_GRACE_LESSONS;
    const title = `Invoice ${invoice.number} is not paid yet`;
    const body = last
      ? `Your next lesson is the last one you can take before paying ${total}. After it, the rest of this cycle's lessons stop until the invoice is paid.`
      : `Your next lesson is lesson ${lessonNo} of ${UNPAID_GRACE_LESSONS} you can take before paying ${total}. After lesson ${UNPAID_GRACE_LESSONS}, your lessons stop until the invoice is paid.`;
    return this.db.transaction(async (tx) => {
      const student = await this.studentUser(tx, invoice.studentId);
      if (!student) return false;
      const told = await this.notices.notify(tx, student.userId, {
        kind: 'payment.due',
        title,
        body,
        link: `/student/invoices/${invoice.id}`,
        dedupKey: `invoice:${invoice.id}:due:${lessonNo}`,
      });
      if (!told.length) return false;
      await this.mail.enqueue(
        tx,
        student.email,
        'payment-due',
        noticeEmail({
          name: student.name,
          title,
          lines: [body],
          button: 'See the invoice',
          link: `${appUrl()}/student/invoices/${invoice.id}`,
        }),
      );
      return true;
    });
  }

  /**
   * At the last lesson of a cycle: the next four weeks need paying. Sent once
   * per cycle, an hour before that lesson, unless the next cycle is paid.
   */
  private async renewalHeadsUp(now: Date): Promise<number> {
    const soon = await this.db
      .select({
        lessonId: lessons.id,
        startsAt: lessons.startsAt,
        cycle: billingCycles,
        sub: subscriptions,
      })
      .from(lessons)
      .innerJoin(billingCycles, eq(billingCycles.id, lessons.cycleId))
      .innerJoin(
        subscriptions,
        eq(subscriptions.id, billingCycles.subscriptionId),
      )
      .where(
        and(
          eq(lessons.status, 'SCHEDULED'),
          eq(subscriptions.status, 'ACTIVE'),
          gt(lessons.startsAt, now),
          lte(
            lessons.startsAt,
            new Date(now.getTime() + WARN_BEFORE_MIN * 60_000),
          ),
          sql`${lessons.extraReason} is distinct from 'MAKEUP'`,
        ),
      );
    let sent = 0;
    for (const l of soon) {
      const [later] = await this.db
        .select({ id: lessons.id })
        .from(lessons)
        .where(
          and(
            eq(lessons.cycleId, l.cycle.id),
            eq(lessons.status, 'SCHEDULED'),
            gt(lessons.startsAt, l.startsAt),
          ),
        )
        .limit(1);
      if (later) continue;
      // The cycle's own invoice still unpaid: the "not paid yet" notices cover it.
      const cycleInvoices = await this.db
        .select({
          id: invoices.id,
          number: invoices.number,
          status: invoices.status,
          totalCents: invoices.totalCents,
          currency: invoices.currency,
          cycleIndex: billingCycles.index,
        })
        .from(invoices)
        .innerJoin(billingCycles, eq(billingCycles.id, invoices.cycleId))
        .where(
          and(
            eq(billingCycles.subscriptionId, l.sub.id),
            inArray(billingCycles.index, [l.cycle.index, l.cycle.index + 1]),
            ne(invoices.status, 'VOID'),
          ),
        );
      const own = cycleInvoices.find((i) => i.cycleIndex === l.cycle.index);
      const next = cycleInvoices.find(
        (i) => i.cycleIndex === l.cycle.index + 1,
      );
      if (own?.status === 'OPEN' && own.totalCents > 0) continue;
      if (next && (next.status === 'PAID' || next.totalCents <= 0)) continue;

      const title = 'Your next four weeks start soon';
      const rule = `You can take ${UNPAID_GRACE_LESSONS} lessons of the new cycle before paying; after that, lessons stop until the invoice is paid.`;
      const body = next
        ? `Your next lesson is the last one of this cycle. Invoice ${next.number} for ${money(next.totalCents, next.currency)} covers the next four weeks: please pay it before your first lesson of the new cycle. ${rule}`
        : `Your next lesson is the last one of this cycle, which ends on ${l.cycle.endDate}. The invoice for the next four weeks comes on that day: please pay it before your first lesson of the new cycle. ${rule}`;
      const link = next ? `/student/invoices/${next.id}` : '/student/invoices';
      const told = await this.db.transaction(async (tx) => {
        const student = await this.studentUser(tx, l.sub.studentId);
        if (!student) return false;
        const ids = await this.notices.notify(tx, student.userId, {
          kind: 'payment.renewal',
          title,
          body,
          link,
          dedupKey: `cycle:${l.cycle.id}:renewal`,
        });
        if (!ids.length) return false;
        await this.mail.enqueue(
          tx,
          student.email,
          'payment-renewal',
          noticeEmail({
            name: student.name,
            title,
            lines: [body],
            button: 'Your invoices',
            link: `${appUrl()}${link}`,
          }),
        );
        return true;
      });
      if (told) sent++;
    }
    return sent;
  }

  /**
   * Stop the lessons of an unpaid invoice's cycle. Checks everything again
   * under a lock, so a payment that lands at the same moment wins.
   * Returns whether the subscription was put on hold.
   */
  async hold(invoiceId: string, now: Date = new Date()): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [inv] = await tx
        .select()
        .from(invoices)
        .where(eq(invoices.id, invoiceId))
        .for('update');
      if (!inv) return false;
      const [cycle] = await tx
        .select()
        .from(billingCycles)
        .where(eq(billingCycles.id, inv.cycleId));
      const [sub] = await tx
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, cycle.subscriptionId))
        .for('update');
      if (!sub || sub.status !== 'ACTIVE') return false;

      const cycleLessons = await this.cycleLessons(tx, cycle.id);
      const taken = cycleLessons.filter((l) => countsAsTaken(l, now)).length;
      const step = unpaidStep({
        status: inv.status,
        totalCents: inv.totalCents,
        lessonsTaken: taken,
        cycleEnded: localDateOf(now, sub.timezone) > cycle.endDate,
      });
      if (step.step !== 'HOLD') return false;

      const removed = await tx
        .update(lessons)
        .set({
          status: 'CANCELLED',
          cancelReason: 'UNPAID',
          cancelledBy: 'SYSTEM',
          cancelledAt: now,
        })
        .where(
          and(
            eq(lessons.cycleId, cycle.id),
            eq(lessons.status, 'SCHEDULED'),
            gt(lessons.startsAt, now),
            sql`${lessons.extraReason} is distinct from 'MAKEUP'`,
          ),
        )
        .returning({ id: lessons.id });

      await tx
        .update(subscriptions)
        .set({ status: 'PAUSED', heldForInvoiceId: inv.id, heldAt: now })
        .where(eq(subscriptions.id, sub.id));
      await this.syncStudentStatus(tx, sub.studentId);

      const why =
        step.why === 'GRACE_USED'
          ? `${plural(taken, 'lesson')} taken without payment`
          : 'the cycle ended unpaid';
      const total = money(inv.totalCents, inv.currency);
      const summary = `Lessons stopped: ${inv.number} (${total}) is unpaid, ${why} · ${plural(removed.length, 'upcoming lesson')} removed`;
      await this.audit.record(tx, null, {
        action: 'subscription.hold',
        entityType: 'subscription',
        entityId: sub.id,
        summary,
        before: { status: 'ACTIVE' },
        after: {
          status: 'PAUSED',
          heldForInvoiceId: inv.id,
          lessonsTaken: taken,
          lessonsRemoved: removed.length,
        },
      });
      await this.audit.record(tx, null, {
        action: 'invoice.hold',
        entityType: 'invoice',
        entityId: inv.id,
        summary,
        after: { lessonsTaken: taken, lessonsRemoved: removed.length },
      });

      const student = await this.studentUser(tx, inv.studentId);
      if (student) {
        const title = 'Your lessons are on hold';
        const body = `Invoice ${inv.number} for ${total} is not paid, so your remaining lessons this cycle were removed. They come back as soon as the invoice is paid.`;
        await this.notices.notify(tx, student.userId, {
          kind: 'payment.hold',
          title,
          body,
          link: `/student/invoices/${inv.id}`,
          dedupKey: `invoice:${inv.id}:hold`,
        });
        await this.mail.enqueue(
          tx,
          student.email,
          'payment-hold',
          noticeEmail({
            name: student.name,
            title,
            lines: [body],
            button: 'See the invoice',
            link: `${appUrl()}/student/invoices/${inv.id}`,
          }),
        );
        await this.notices.notifyStaff(tx, 'billing', {
          kind: 'payment.hold',
          title: `${student.name}: lessons on hold`,
          body: `${inv.number} (${total}) is unpaid, ${why}. ${plural(removed.length, 'upcoming lesson')} removed. Marking the invoice paid brings them back.`,
          link: `/admin/invoices/${inv.id}`,
          dedupKey: `invoice:${inv.id}:hold`,
        });
        const teacherUser = await this.teacherUserId(tx, sub.teacherId);
        if (teacherUser && removed.length)
          await this.notices.notify(tx, teacherUser, {
            kind: 'lessons.hold',
            title: `${student.name}: lessons on hold`,
            body: `${plural(removed.length, 'upcoming lesson')} with ${student.name} ${removed.length === 1 ? 'was' : 'were'} removed from your calendar by the academy. You will be told if they come back.`,
            link: '/teacher/calendar',
            dedupKey: `invoice:${inv.id}:hold`,
          });
      }
      return true;
    });
  }

  /** A student with no active subscription left is PAUSED, otherwise ACTIVE. */
  private async syncStudentStatus(tx: Tx, studentId: string) {
    const [active] = await tx
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.studentId, studentId),
          eq(subscriptions.status, 'ACTIVE'),
        ),
      )
      .limit(1);
    const [student] = await tx
      .select({ status: students.status })
      .from(students)
      .where(eq(students.id, studentId));
    // Someone who left the academy stays as they are.
    if (!student || student.status === 'EXITED') return;
    const status = active ? 'ACTIVE' : 'PAUSED';
    if (student.status !== status)
      await tx
        .update(students)
        .set({ status })
        .where(eq(students.id, studentId));
  }

  /**
   * The invoice a subscription was waiting for has just been paid (call it in
   * the same transaction). Lessons still ahead come back when the teacher and
   * the student are still free then; the others become credits on the next
   * invoice. While the cycle is still running the subscription is active
   * again; once it is over it stays paused and the credits wait for new
   * weekly lessons.
   */
  async resumeAfterPayment(
    tx: Tx,
    inv: Invoice,
    actor: AuthUser,
    now: Date = new Date(),
  ): Promise<{
    subscriptionId: string;
    restored: number;
    credited: number;
    active: boolean;
  } | null> {
    const [sub] = await tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.heldForInvoiceId, inv.id))
      .for('update');
    if (!sub) return null;
    const [cycle] = await tx
      .select()
      .from(billingCycles)
      .where(eq(billingCycles.id, inv.cycleId));

    const stopped = await tx
      .select({
        id: lessons.id,
        startsAt: lessons.startsAt,
        durationMin: lessons.durationMin,
        teacherId: lessons.teacherId,
        studentId: lessons.studentId,
      })
      .from(lessons)
      .where(
        and(
          eq(lessons.cycleId, cycle.id),
          eq(lessons.status, 'CANCELLED'),
          eq(lessons.cancelReason, 'UNPAID'),
        ),
      )
      .orderBy(asc(lessons.startsAt));

    const cycleRunning = localDateOf(now, sub.timezone) <= cycle.endDate;
    let restored = 0;
    let credited = 0;
    for (const l of stopped) {
      let free = cycleRunning && l.startsAt > now;
      if (free) {
        // Someone else may have been given the time meanwhile.
        const around = await tx
          .select({
            startsAt: lessons.startsAt,
            durationMin: lessons.durationMin,
          })
          .from(lessons)
          .where(
            and(
              inArray(lessons.status, ['SCHEDULED', 'COMPLETED']),
              sql`(${lessons.teacherId} = ${l.teacherId} or ${lessons.studentId} = ${l.studentId})`,
              gte(
                lessons.startsAt,
                new Date(l.startsAt.getTime() - 24 * 3600_000),
              ),
              lte(
                lessons.startsAt,
                new Date(l.startsAt.getTime() + 24 * 3600_000),
              ),
            ),
          );
        free = !around.some((b) => overlaps(l, b));
      }
      if (free) {
        await tx
          .update(lessons)
          .set({
            status: 'SCHEDULED',
            cancelReason: null,
            cancelledBy: null,
            cancelledAt: null,
            reminderSentAt: null,
          })
          .where(eq(lessons.id, l.id));
        restored++;
      } else {
        const made = await tx
          .insert(lessonCredits)
          .values({ studentId: l.studentId, lessonId: l.id })
          .onConflictDoNothing()
          .returning({ id: lessonCredits.id });
        credited += made.length;
      }
    }

    await tx
      .update(subscriptions)
      .set({
        status: cycleRunning ? 'ACTIVE' : 'PAUSED',
        heldForInvoiceId: null,
        heldAt: null,
      })
      .where(eq(subscriptions.id, sub.id));
    await this.syncStudentStatus(tx, sub.studentId);

    const parts = [
      restored && `${plural(restored, 'lesson')} back on the calendar`,
      credited && `${plural(credited, 'lesson')} turned into credit`,
    ].filter(Boolean);
    await this.audit.record(tx, actor, {
      action: 'subscription.resume',
      entityType: 'subscription',
      entityId: sub.id,
      summary: `${inv.number} paid: ${parts.join(', ') || 'no lessons to bring back'}${cycleRunning ? '' : ' · the cycle is over, so the subscription stays paused'}`,
      before: { status: 'PAUSED', heldForInvoiceId: inv.id },
      after: {
        status: cycleRunning ? 'ACTIVE' : 'PAUSED',
        restored,
        credited,
      },
    });

    const student = await this.studentUser(tx, sub.studentId);
    if (student) {
      await this.notices.notify(tx, student.userId, {
        kind: 'payment.resumed',
        title: cycleRunning ? 'Your lessons are back' : 'Payment received',
        body:
          [
            restored &&
              `${plural(restored, 'lesson')} are back on your calendar`,
            credited &&
              `${plural(credited, 'missed lesson')} will come off your next invoice`,
          ]
            .filter(Boolean)
            .join(' and ') + '. Thank you.',
        link: '/student/calendar',
      });
      const teacherUser = await this.teacherUserId(tx, sub.teacherId);
      if (teacherUser && restored)
        await this.notices.notify(tx, teacherUser, {
          kind: 'lessons.resumed',
          title: `${student.name}: lessons are back`,
          body: `${plural(restored, 'lesson')} with ${student.name} ${restored === 1 ? 'is' : 'are'} back on your calendar.`,
          link: '/teacher/calendar',
        });
    }
    return { subscriptionId: sub.id, restored, credited, active: cycleRunning };
  }

  /**
   * The invoice a subscription waits for was voided. With a replacement for
   * the whole cycle the subscription waits for that one instead; otherwise
   * (no replacement, or one for the lessons taken only) it becomes an
   * ordinary pause and the removed lessons stay removed.
   */
  async moveHold(tx: Tx, voidedId: string, replacementId: string | null) {
    await tx
      .update(subscriptions)
      .set(
        replacementId
          ? { heldForInvoiceId: replacementId }
          : { heldForInvoiceId: null, heldAt: null },
      )
      .where(eq(subscriptions.heldForInvoiceId, voidedId));
  }

  /** Invoice ids that have lessons on hold right now. */
  async heldInvoiceIds(exec: Executor = this.db): Promise<Set<string>> {
    const rows = await exec
      .select({ id: subscriptions.heldForInvoiceId })
      .from(subscriptions)
      .where(isNotNull(subscriptions.heldForInvoiceId));
    return new Set(rows.map((r) => r.id!));
  }

  /**
   * Where one unpaid invoice stands: lessons taken, how many can still be
   * taken before the lessons stop, and whether they already stopped.
   */
  async standing(
    inv: Pick<Invoice, 'id' | 'status' | 'totalCents'>,
    cycle: Pick<Cycle, 'id' | 'startDate' | 'endDate'>,
    sub: Pick<Subscription, 'timezone' | 'heldForInvoiceId'>,
    now: Date = new Date(),
  ) {
    const cycleLessons = await this.cycleLessons(this.db, cycle.id);
    const taken = cycleLessons.filter((l) => countsAsTaken(l, now)).length;
    const today = localDateOf(now, sub.timezone);
    const onHold = sub.heldForInvoiceId === inv.id;
    const due = inv.status === 'OPEN' && inv.totalCents > 0;
    return {
      /** prepaid: due on the first day of its cycle */
      dueDate: cycle.startDate,
      overdue: due && today >= cycle.startDate,
      lessonsTaken: taken,
      graceLessons: UNPAID_GRACE_LESSONS,
      lessonsLeftBeforeHold:
        due && !onHold ? Math.max(0, UNPAID_GRACE_LESSONS - taken) : 0,
      onHold,
      /** lessons taken off the calendar because the invoice is unpaid */
      lessonsRemoved: cycleLessons.filter(
        (l) => l.status === 'CANCELLED' && l.cancelReason === 'UNPAID',
      ).length,
    };
  }

  /** A student's invoices that need paying, most urgent first. */
  async dueFor(studentId: string, now: Date = new Date()) {
    const rows = await this.db
      .select({ invoice: invoices, cycle: billingCycles, sub: subscriptions })
      .from(invoices)
      .innerJoin(billingCycles, eq(billingCycles.id, invoices.cycleId))
      .innerJoin(
        subscriptions,
        eq(subscriptions.id, billingCycles.subscriptionId),
      )
      .where(
        and(
          eq(invoices.studentId, studentId),
          eq(invoices.status, 'OPEN'),
          gt(invoices.totalCents, 0),
        ),
      )
      .orderBy(asc(billingCycles.startDate));
    const out = [];
    for (const r of rows) {
      const s = await this.standing(r.invoice, r.cycle, r.sub, now);
      out.push({
        id: r.invoice.id,
        number: r.invoice.number,
        totalCents: r.invoice.totalCents,
        currency: r.invoice.currency,
        cycleStart: r.cycle.startDate,
        cycleEnd: r.cycle.endDate,
        dueDate: s.dueDate,
        overdue: s.overdue,
        lessonsTaken: s.lessonsTaken,
        lessonsLeftBeforeHold: s.lessonsLeftBeforeHold,
        onHold: s.onHold,
      });
    }
    return out;
  }
}
