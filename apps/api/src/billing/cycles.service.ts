import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { DB, type Db, type Tx } from '../db/db.module.js';
import {
  billingCycles,
  invoices,
  lessonCharges,
  lessonCredits,
  lessons,
  type LessonType,
  plans,
  students,
  subscriptions,
  users,
} from '../db/schema.js';
import { appUrl, MailService } from '../mail/mail.service.js';
import { invoiceEmail } from '../mail/templates.js';
import { paymentInstructions } from '../settings/academy-settings.js';
import {
  cycleRange,
  invoiceFor,
  invoiceNumber,
  WEEKS_PER_CYCLE,
} from '../rules/billing.js';
import { localDateOf, occurrencesInRange } from '../rules/schedule.js';

/**
 * Billing cycles: every 28 days a subscription gets a new cycle with its
 * lessons generated from the weekly slots and a prepaid invoice.
 */
@Injectable()
export class CyclesService {
  private readonly log = new Logger(CyclesService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  /** Tell the student about a new invoice (sent after the transaction commits). */
  private async emailInvoice(
    tx: Tx,
    invoice: {
      id: string;
      number: string;
      studentId: string;
      totalCents: number;
      currency: string;
      billedLessons: number;
    },
    cycleId: string,
  ) {
    const [row] = await tx
      .select({
        name: users.fullName,
        email: users.email,
        from: billingCycles.startDate,
        to: billingCycles.endDate,
      })
      .from(students)
      .innerJoin(users, eq(users.id, students.userId))
      .innerJoin(billingCycles, eq(billingCycles.id, cycleId))
      .where(eq(students.id, invoice.studentId));
    if (!row) return;
    const total = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: invoice.currency,
    }).format(invoice.totalCents / 100);
    await this.mail.enqueue(
      tx,
      row.email,
      'invoice',
      invoiceEmail({
        name: row.name,
        number: invoice.number,
        total,
        from: row.from,
        to: row.to,
        lessons: invoice.billedLessons,
        link: `${appUrl()}/student/invoices/${invoice.id}`,
        howToPay: await paymentInstructions(tx),
      }),
    );
  }

  /** Create cycle `index`: its lessons and its invoice. Run inside a transaction. */
  async createCycle(
    tx: Tx,
    subscriptionId: string,
    index: number,
    actor: AuthUser | null,
  ) {
    const sub = await tx.query.subscriptions.findFirst({
      where: eq(subscriptions.id, subscriptionId),
      with: { plan: true, slots: true },
    });
    if (!sub) throw new NotFoundException('Subscription not found');

    const range = cycleRange(sub.startDate, index);
    const [cycle] = await tx
      .insert(billingCycles)
      .values({
        subscriptionId,
        index,
        startDate: range.startDate,
        endDate: range.endDate,
      })
      .returning();

    const times = occurrencesInRange({
      timezone: sub.timezone,
      slots: sub.slots,
      fromDate: range.startDate,
      toDate: range.endDate,
    });

    let firstType: LessonType = 'REGULAR';
    if (index === 1) {
      const [earlier] = await tx
        .select({ id: lessons.id })
        .from(lessons)
        .where(eq(lessons.studentId, sub.studentId))
        .limit(1);
      firstType = earlier ? 'RETURNING' : 'FIRST_LESSON';
    }

    if (times.length) {
      await tx.insert(lessons).values(
        times.map((startsAt, i) => ({
          subscriptionId,
          cycleId: cycle.id,
          studentId: sub.studentId,
          teacherId: sub.teacherId,
          curriculumId: sub.curriculumId,
          startsAt,
          durationMin: sub.plan.lessonMinutes,
          type: i === 0 ? firstType : ('REGULAR' as const),
        })),
      );
    }

    const invoice = await this.issueInvoice(tx, cycle.id, {
      studentId: sub.studentId,
      lessonsPerWeek: sub.lessonsPerWeek,
      priceCents: sub.plan.priceCents,
      currency: sub.plan.currency,
    });

    await this.emailInvoice(tx, invoice, cycle.id);
    await this.audit.record(tx, actor, {
      action: 'cycle.create',
      entityType: 'subscription',
      entityId: subscriptionId,
      summary: `Cycle ${index} (${range.startDate} – ${range.endDate}): ${times.length} lessons, invoice ${invoice.number}`,
      after: {
        cycleId: cycle.id,
        lessons: times.length,
        invoiceId: invoice.id,
        billedLessons: invoice.billedLessons,
      },
    });
    return { cycle, invoice, lessonsCreated: times.length };
  }

  /**
   * A new invoice for a cycle whose invoice was just voided: the same number of
   * lessons, the plan's price today, and the student's open credits and extra
   * lessons (the void one gave its own back). Run inside a transaction.
   */
  async reissueInvoice(
    tx: Tx,
    voided: {
      id: string;
      number: string;
      cycleId: string;
      lessonsCount: number;
    },
    actor: AuthUser,
    /** bill only this many lessons (the cycle was cut short for non-payment) */
    billLessons?: number,
  ) {
    const [row] = await tx
      .select({
        studentId: subscriptions.studentId,
        priceCents: plans.priceCents,
        currency: plans.currency,
      })
      .from(billingCycles)
      .innerJoin(
        subscriptions,
        eq(subscriptions.id, billingCycles.subscriptionId),
      )
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(eq(billingCycles.id, voided.cycleId));
    if (!row) throw new NotFoundException('Cycle not found');
    const invoice = await this.issueInvoice(
      tx,
      voided.cycleId,
      {
        ...row,
        lessonsPerWeek: voided.lessonsCount / WEEKS_PER_CYCLE,
        lessonsCount: billLessons ?? voided.lessonsCount,
      },
      voided.id,
    );
    await this.emailInvoice(tx, invoice, voided.cycleId);
    await this.audit.record(tx, actor, {
      action: 'invoice.reissue',
      entityType: 'invoice',
      entityId: invoice.id,
      summary: `${invoice.number} issued to replace ${voided.number}: ${invoice.billedLessons} lessons, ${(invoice.totalCents / 100).toFixed(2)} ${invoice.currency}`,
      after: {
        replacesId: voided.id,
        billedLessons: invoice.billedLessons,
        totalCents: invoice.totalCents,
      },
    });
    return invoice;
  }

  /**
   * Prepaid invoice for a cycle. Pending credits come off, oldest first;
   * extra lessons added after the last invoice was paid go on.
   */
  private async issueInvoice(
    tx: Tx,
    cycleId: string,
    s: {
      studentId: string;
      lessonsPerWeek: number;
      /** when the invoice is not for the whole cycle */
      lessonsCount?: number;
      priceCents: number;
      currency: string;
    },
    replacesId?: string,
  ) {
    const pending = await tx
      .select({ id: lessonCredits.id })
      .from(lessonCredits)
      .where(
        and(
          eq(lessonCredits.studentId, s.studentId),
          eq(lessonCredits.status, 'PENDING'),
        ),
      )
      .orderBy(asc(lessonCredits.createdAt));

    const charges = await tx
      .select({ id: lessonCharges.id })
      .from(lessonCharges)
      .where(
        and(
          eq(lessonCharges.studentId, s.studentId),
          eq(lessonCharges.status, 'PENDING'),
        ),
      );

    const amounts = invoiceFor({
      lessonsPerWeek: s.lessonsPerWeek,
      lessonsCount: s.lessonsCount,
      priceCents: s.priceCents,
      pendingCredits: pending.length,
      extraLessons: charges.length,
    });
    const seq = await tx.execute<{ n: string }>(
      sql`select nextval('invoice_number_seq') as n`,
    );
    const [invoice] = await tx
      .insert(invoices)
      .values({
        number: invoiceNumber(Number(seq.rows[0].n)),
        studentId: s.studentId,
        cycleId,
        lessonsCount: amounts.lessonsCount,
        creditsCount: amounts.creditsApplied,
        extraCount: amounts.extraCount,
        billedLessons: amounts.billedLessons,
        priceCents: s.priceCents,
        totalCents: amounts.totalCents,
        currency: s.currency,
        replacesId,
      })
      .returning();

    const applied = pending.slice(0, amounts.creditsApplied).map((c) => c.id);
    if (applied.length) {
      await tx
        .update(lessonCredits)
        .set({ status: 'APPLIED', invoiceId: invoice.id })
        .where(inArray(lessonCredits.id, applied));
    }
    if (charges.length) {
      await tx
        .update(lessonCharges)
        .set({ status: 'APPLIED', invoiceId: invoice.id })
        .where(
          inArray(
            lessonCharges.id,
            charges.map((c) => c.id),
          ),
        );
    }
    return invoice;
  }

  /**
   * Hourly: on the last local day of a cycle, open the next one so its
   * lessons and its prepaid invoice exist before it starts.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async rollover(now: Date = new Date()): Promise<number> {
    const active = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.status, 'ACTIVE'));
    let created = 0;
    for (const sub of active) {
      const [last] = await this.db
        .select()
        .from(billingCycles)
        .where(eq(billingCycles.subscriptionId, sub.id))
        .orderBy(desc(billingCycles.index))
        .limit(1);
      if (!last) continue;
      if (localDateOf(now, sub.timezone) < last.endDate) continue;
      // No new cycle on top of an unpaid one: the lessons are stopped until
      // the invoice is paid (see UnpaidService), then the cycles carry on.
      const [debt] = await this.db
        .select({ id: invoices.id })
        .from(invoices)
        .where(
          and(
            eq(invoices.cycleId, last.id),
            eq(invoices.status, 'OPEN'),
            gt(invoices.totalCents, 0),
          ),
        )
        .limit(1);
      if (debt) continue;
      try {
        await this.db.transaction((tx) =>
          this.createCycle(tx, sub.id, last.index + 1, null),
        );
        created++;
      } catch (err) {
        // Unique (subscription, index) stops double creation if two runs overlap.
        this.log.warn(
          `Could not open cycle ${last.index + 1} for subscription ${sub.id}: ${(err as Error).message}`,
        );
      }
    }
    return created;
  }
}
