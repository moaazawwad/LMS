import { ApiTags } from '@nestjs/swagger';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { alias } from 'drizzle-orm/pg-core';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lt,
  or,
  type SQL,
  sum,
} from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import {
  Area,
  type AuthUser,
  CurrentUser,
  isStaff,
  Roles,
} from '../common/auth-user.js';
import { DB, type Db } from '../db/db.module.js';
import {
  billingCycles,
  curricula,
  invoices,
  invoiceStatusEnum,
  lessonCharges,
  lessonCredits,
  lessons,
  plans,
  students,
  subscriptions,
  teachers,
  users,
} from '../db/schema.js';
import { PAYMENT_METHODS, type PaymentMethod } from '../rules/billing.js';
import { ACADEMY_TZ, dayBounds, localDateOf } from '../rules/schedule.js';
import { appUrl, MailService } from '../mail/mail.service.js';
import { paymentReceivedEmail } from '../mail/templates.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { paymentInstructions } from '../settings/academy-settings.js';
import { CyclesService } from './cycles.service.js';
import { UnpaidService } from './unpaid.service.js';

class InvoiceQueryDto {
  @IsOptional() @IsIn(invoiceStatusEnum.enumValues) status?:
    'OPEN' | 'PAID' | 'VOID';
  @IsOptional() @IsUUID() studentId?: string;
  /** student name or email, or the invoice number (staff) */
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  /** issued on or after this Cairo day */
  @IsOptional() @IsISO8601({ strict: true }) from?: string;
  /** issued on or before this Cairo day */
  @IsOptional() @IsISO8601({ strict: true }) to?: string;
}

class VoidInvoiceDto {
  /** why: kept on the invoice and in the activity log */
  @IsString() @MinLength(3) @MaxLength(500) reason: string;
  /** issue a new invoice for the same cycle straight away */
  @IsOptional() @IsBoolean() reissue?: boolean;
  /**
   * With reissue: bill this many lessons instead of the whole cycle, e.g. the
   * lessons taken before the rest were stopped for non-payment.
   */
  @IsOptional() @IsInt() @Min(0) billLessons?: number;
}

class PayInvoiceDto {
  /** how the money came in */
  @IsOptional() @IsIn(PAYMENT_METHODS) method?: PaymentMethod;
  /** the transfer or receipt number */
  @IsOptional() @IsString() @MaxLength(120) reference?: string;
  /** the Cairo day the money arrived (today when left out) */
  @IsOptional() @IsISO8601({ strict: true }) receivedOn?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

class UnpayInvoiceDto {
  /** why the payment is taken back: kept in the activity log */
  @IsString() @MinLength(3) @MaxLength(500) reason: string;
}

/** The most rows one list returns; narrow it down with the filters. */
const LIST_LIMIT = 200;

@ApiTags('Invoices')
@Controller('invoices')
export class InvoicesController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly cycles: CyclesService,
    private readonly mail: MailService,
    private readonly unpaid: UnpaidService,
    private readonly notices: NotificationsService,
  ) {}

  @Get()
  @Area('billing')
  async list(@CurrentUser() user: AuthUser, @Query() q: InvoiceQueryDto) {
    const where: SQL[] = [];
    if (user.role === 'STUDENT')
      where.push(eq(invoices.studentId, user.studentId!));
    else if (!isStaff(user)) throw new ForbiddenException();
    else if (q.studentId) where.push(eq(invoices.studentId, q.studentId));
    if (q.status) where.push(eq(invoices.status, q.status));
    if (q.from && q.to && q.to < q.from)
      throw new BadRequestException('The last day is before the first day.');
    if (q.from)
      where.push(gte(invoices.issuedAt, dayBounds(q.from, ACADEMY_TZ).from));
    if (q.to) where.push(lt(invoices.issuedAt, dayBounds(q.to, ACADEMY_TZ).to));
    const text = q.q?.trim();
    if (text && isStaff(user)) {
      const like = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where.push(
        or(
          ilike(users.fullName, like),
          ilike(users.email, like),
          ilike(invoices.number, like),
        )!,
      );
    }

    const held = isStaff(user)
      ? await this.unpaid.heldInvoiceIds()
      : new Set<string>();
    const rows = await this.db
      .select({
        id: invoices.id,
        number: invoices.number,
        status: invoices.status,
        studentId: invoices.studentId,
        studentName: users.fullName,
        cycleIndex: billingCycles.index,
        cycleStart: billingCycles.startDate,
        cycleEnd: billingCycles.endDate,
        lessonsCount: invoices.lessonsCount,
        creditsCount: invoices.creditsCount,
        extraCount: invoices.extraCount,
        billedLessons: invoices.billedLessons,
        priceCents: invoices.priceCents,
        totalCents: invoices.totalCents,
        currency: invoices.currency,
        issuedAt: invoices.issuedAt,
        paidAt: invoices.paidAt,
        paymentMethod: invoices.paymentMethod,
        paymentReference: invoices.paymentReference,
        receivedOn: invoices.receivedOn,
        voidedAt: invoices.voidedAt,
        replacesId: invoices.replacesId,
      })
      .from(invoices)
      .innerJoin(billingCycles, eq(billingCycles.id, invoices.cycleId))
      .innerJoin(students, eq(students.id, invoices.studentId))
      .innerJoin(users, eq(users.id, students.userId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(invoices.issuedAt), desc(invoices.number))
      .limit(LIST_LIMIT);
    const today = localDateOf(new Date(), ACADEMY_TZ);
    return rows.map((r) => ({
      ...r,
      /** prepaid: due and its cycle has started */
      overdue: r.status === 'OPEN' && r.totalCents > 0 && r.cycleStart <= today,
      /** the lessons are stopped until this one is paid (staff only) */
      onHold: held.has(r.id),
    }));
  }

  /** What the signed-in student owes right now, and where their lessons stand. */
  @Get('due')
  @Roles('STUDENT')
  due(@CurrentUser() user: AuthUser) {
    return this.unpaid.dueFor(user.studentId!);
  }

  /** How many invoices are due, paid and void, and what is due, all time. */
  @Get('summary')
  @Roles('ADMIN', 'STAFF')
  @Area('billing')
  async summary() {
    const rows = await this.db
      .select({
        status: invoices.status,
        currency: invoices.currency,
        count: count(),
        totalCents: sum(invoices.totalCents).mapWith(Number),
      })
      .from(invoices)
      .groupBy(invoices.status, invoices.currency);
    const of = (status: 'OPEN' | 'PAID' | 'VOID') => {
      const mine = rows.filter((r) => r.status === status);
      return {
        count: mine.reduce((n, r) => n + r.count, 0),
        totals: mine.map((r) => ({
          currency: r.currency,
          cents: r.totalCents ?? 0,
        })),
      };
    };
    return {
      open: of('OPEN'),
      paid: of('PAID'),
      void: of('VOID'),
      listLimit: LIST_LIMIT,
    };
  }

  /**
   * One invoice with what it covers: the cycle's lessons, the credits that
   * came off it (and which lessons they were for). Students: their own only.
   */
  @Get(':id')
  @Area('billing')
  async detail(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const voidedBy = alias(users, 'voided_by');
    const teacherUser = alias(users, 'teacher_user');
    const paidBy = alias(users, 'paid_by');
    const [row] = await this.db
      .select({
        invoice: invoices,
        cycle: billingCycles,
        studentName: users.fullName,
        studentEmail: users.email,
        timezone: subscriptions.timezone,
        plan: plans.name,
        lessonMinutes: plans.lessonMinutes,
        curriculum: curricula.name,
        subscriptionId: subscriptions.id,
        heldForInvoiceId: subscriptions.heldForInvoiceId,
        voidedBy: voidedBy.fullName,
        paidBy: paidBy.fullName,
        teacherName: teacherUser.fullName,
      })
      .from(invoices)
      .innerJoin(billingCycles, eq(billingCycles.id, invoices.cycleId))
      .innerJoin(
        subscriptions,
        eq(subscriptions.id, billingCycles.subscriptionId),
      )
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .innerJoin(curricula, eq(curricula.id, subscriptions.curriculumId))
      .innerJoin(students, eq(students.id, invoices.studentId))
      .innerJoin(users, eq(users.id, students.userId))
      .leftJoin(voidedBy, eq(voidedBy.id, invoices.voidedById))
      .leftJoin(paidBy, eq(paidBy.id, invoices.paidById))
      .leftJoin(teachers, eq(teachers.id, subscriptions.teacherId))
      .leftJoin(teacherUser, eq(teacherUser.id, teachers.userId))
      .where(eq(invoices.id, id));
    if (!row) throw new NotFoundException();
    if (
      !isStaff(user) &&
      !(user.role === 'STUDENT' && user.studentId === row.invoice.studentId)
    )
      throw new NotFoundException();

    const cycleLessons = await this.db
      .select({
        startsAt: lessons.startsAt,
        status: lessons.status,
        type: lessons.type,
        countedAsTaken: lessons.countedAsTaken,
      })
      .from(lessons)
      .where(eq(lessons.cycleId, row.cycle.id))
      .orderBy(asc(lessons.startsAt));
    const credits = await this.db
      .select({
        lessonStartsAt: lessons.startsAt,
        cancelReason: lessons.cancelReason,
      })
      .from(lessonCredits)
      .innerJoin(lessons, eq(lessons.id, lessonCredits.lessonId))
      .where(eq(lessonCredits.invoiceId, id))
      .orderBy(asc(lessons.startsAt));
    const extras = await this.db
      .select({ lessonStartsAt: lessons.startsAt, status: lessons.status })
      .from(lessonCharges)
      .innerJoin(lessons, eq(lessons.id, lessonCharges.lessonId))
      .where(eq(lessonCharges.invoiceId, id))
      .orderBy(asc(lessons.startsAt));
    const link = { id: invoices.id, number: invoices.number };
    const [replaces] = row.invoice.replacesId
      ? await this.db
          .select(link)
          .from(invoices)
          .where(eq(invoices.id, row.invoice.replacesId))
      : [];
    const [replacedBy] = await this.db
      .select(link)
      .from(invoices)
      .where(eq(invoices.replacesId, id))
      .limit(1);

    const i = row.invoice;
    const staff = isStaff(user);
    return {
      id: i.id,
      number: i.number,
      status: i.status,
      issuedAt: i.issuedAt,
      paidAt: i.paidAt,
      currency: i.currency,
      priceCents: i.priceCents,
      lessonsCount: i.lessonsCount,
      creditsCount: i.creditsCount,
      extraCount: i.extraCount,
      billedLessons: i.billedLessons,
      totalCents: i.totalCents,
      student: {
        id: i.studentId,
        name: row.studentName,
        email: row.studentEmail,
        timezone: row.timezone,
      },
      plan: row.plan,
      lessonMinutes: row.lessonMinutes,
      teacher: row.teacherName,
      curriculum: row.curriculum,
      cycle: {
        index: row.cycle.index,
        startDate: row.cycle.startDate,
        endDate: row.cycle.endDate,
      },
      // Moved lessons are shown once, at their new time.
      lessons: cycleLessons.filter((l) => l.status !== 'RESCHEDULED'),
      credits,
      /** extra lessons billed on this invoice (they may sit in another cycle) */
      extras,
      /** when it was voided; who and why for staff only */
      voided:
        i.status === 'VOID'
          ? {
              at: i.voidedAt,
              by: staff ? row.voidedBy : null,
              reason: staff ? i.voidReason : null,
            }
          : null,
      /** how it was paid; who recorded it and their note for staff only */
      payment:
        i.status === 'PAID'
          ? {
              method: i.paymentMethod,
              reference: i.paymentReference,
              receivedOn: i.receivedOn,
              recordedBy: staff ? row.paidBy : null,
              note: staff ? i.paymentNote : null,
            }
          : null,
      /** while it is due: lessons of grace left, or the lessons are stopped */
      standing: await this.unpaid.standing(i, row.cycle, {
        timezone: row.timezone,
        heldForInvoiceId: row.heldForInvoiceId,
      }),
      replaces: replaces ?? null,
      replacedBy: replacedBy ?? null,
      /** how to pay, while the invoice is due */
      paymentInstructions:
        i.status === 'OPEN' ? await paymentInstructions(this.db) : null,
    };
  }

  @Post(':id/pay')
  @Area('billing')
  @HttpCode(200)
  @Roles('ADMIN', 'STAFF')
  async pay(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PayInvoiceDto = {},
  ) {
    const now = new Date();
    const today = localDateOf(now, ACADEMY_TZ);
    const receivedOn = body.receivedOn?.slice(0, 10) ?? today;
    if (receivedOn > today)
      throw new BadRequestException(
        'The day the money arrived cannot be in the future.',
      );
    const reference = body.reference?.trim() || null;
    const note = body.note?.trim() || null;
    return this.db.transaction(async (tx) => {
      const [inv] = await tx
        .select()
        .from(invoices)
        .where(eq(invoices.id, id))
        .for('update');
      if (!inv) throw new NotFoundException();
      if (inv.status !== 'OPEN')
        throw new ConflictException(`Invoice is ${inv.status.toLowerCase()}.`);
      const [row] = await tx
        .update(invoices)
        .set({
          status: 'PAID',
          paidAt: now,
          paymentMethod: body.method ?? null,
          paymentReference: reference,
          receivedOn,
          paymentNote: note,
          paidById: user.userId,
        })
        .where(eq(invoices.id, id))
        .returning();
      // Lessons stopped for this invoice are booked again.
      const resumed = await this.unpaid.resumeAfterPayment(tx, row, user, now);
      const [student] = await tx
        .select({ name: users.fullName, email: users.email })
        .from(students)
        .innerJoin(users, eq(users.id, students.userId))
        .where(eq(students.id, inv.studentId));
      if (student) {
        const total = new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: inv.currency,
        }).format(inv.totalCents / 100);
        await this.mail.enqueue(
          tx,
          student.email,
          'payment',
          paymentReceivedEmail({
            name: student.name,
            number: inv.number,
            total,
            link: `${appUrl()}/student/invoices/${inv.id}`,
          }),
        );
        this.mail.sendSoon();
        const [studentUser] = await tx
          .select({ userId: students.userId })
          .from(students)
          .where(eq(students.id, inv.studentId));
        if (studentUser)
          await this.notices.notify(tx, studentUser.userId, {
            kind: 'payment.received',
            title: 'Payment received',
            body: `We received your payment for invoice ${inv.number} (${total}). Thank you.`,
            link: `/student/invoices/${inv.id}`,
            dedupKey: `invoice:${inv.id}:paid:${now.getTime()}`,
          });
      }
      const how = [
        body.method && body.method.toLowerCase().replace(/_/g, ' '),
        reference && `ref ${reference}`,
        receivedOn !== today && `received ${receivedOn}`,
      ]
        .filter(Boolean)
        .join(', ');
      await this.audit.record(tx, user, {
        action: 'invoice.pay',
        entityType: 'invoice',
        entityId: id,
        summary: `${inv.number} marked paid (${(inv.totalCents / 100).toFixed(2)} ${inv.currency})${how ? ` · ${how}` : ''}`,
        before: { status: inv.status },
        after: {
          status: row.status,
          paidAt: row.paidAt,
          method: row.paymentMethod,
          reference: row.paymentReference,
          receivedOn: row.receivedOn,
        },
        note: note ?? undefined,
      });
      return { ...row, resumed };
    });
  }

  /**
   * Take a payment back (marked paid by mistake, a transfer that bounced).
   * The invoice is due again; the unpaid rules apply from the next check.
   */
  @Post(':id/unpay')
  @HttpCode(200)
  @Roles('ADMIN')
  async unpay(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UnpayInvoiceDto,
  ) {
    const reason = body.reason.trim();
    if (reason.length < 3)
      throw new BadRequestException('Say why the payment is taken back.');
    return this.db.transaction(async (tx) => {
      const [inv] = await tx
        .select()
        .from(invoices)
        .where(eq(invoices.id, id))
        .for('update');
      if (!inv) throw new NotFoundException();
      if (inv.status !== 'PAID')
        throw new ConflictException('Only a paid invoice can be reopened.');
      const [row] = await tx
        .update(invoices)
        .set({
          status: 'OPEN',
          paidAt: null,
          paymentMethod: null,
          paymentReference: null,
          receivedOn: null,
          paymentNote: null,
          paidById: null,
        })
        .where(eq(invoices.id, id))
        .returning();
      await this.audit.record(tx, user, {
        action: 'invoice.unpay',
        entityType: 'invoice',
        entityId: id,
        summary: `${inv.number} is due again: the payment was taken back (${(inv.totalCents / 100).toFixed(2)} ${inv.currency})`,
        before: {
          status: inv.status,
          paidAt: inv.paidAt,
          method: inv.paymentMethod,
          reference: inv.paymentReference,
          receivedOn: inv.receivedOn,
        },
        after: { status: row.status },
        note: reason,
      });
      return row;
    });
  }

  /**
   * Void an invoice. The credits and extra lessons on it go back to waiting
   * for the next invoice, or straight onto a new one for the same cycle
   * (reissue). A paid invoice can be voided too; refunding is done outside.
   */
  @Post(':id/void')
  @HttpCode(200)
  @Roles('ADMIN')
  async void(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: VoidInvoiceDto,
  ) {
    const reason = body.reason.trim();
    if (reason.length < 3)
      throw new BadRequestException('Say why the invoice is void.');
    if (body.billLessons !== undefined && !body.reissue)
      throw new BadRequestException(
        'Billing some of the lessons needs a new invoice (reissue).',
      );
    return this.db.transaction(async (tx) => {
      const [inv] = await tx
        .select()
        .from(invoices)
        .where(eq(invoices.id, id))
        .for('update');
      if (!inv) throw new NotFoundException();
      if (inv.status === 'VOID')
        throw new ConflictException('Invoice is already void.');
      if (body.billLessons !== undefined && body.billLessons > inv.lessonsCount)
        throw new BadRequestException(
          `This invoice covers ${inv.lessonsCount} lessons: the new one cannot bill more.`,
        );
      const [row] = await tx
        .update(invoices)
        .set({
          status: 'VOID',
          voidedAt: new Date(),
          voidedById: user.userId,
          voidReason: reason,
        })
        .where(eq(invoices.id, id))
        .returning();
      const credits = await tx
        .update(lessonCredits)
        .set({ status: 'PENDING', invoiceId: null })
        .where(eq(lessonCredits.invoiceId, id))
        .returning({ id: lessonCredits.id });
      const charges = await tx
        .update(lessonCharges)
        .set({ status: 'PENDING', invoiceId: null })
        .where(eq(lessonCharges.invoiceId, id))
        .returning({ id: lessonCharges.id });
      const back = [
        credits.length &&
          `${credits.length} credit${credits.length === 1 ? '' : 's'}`,
        charges.length &&
          `${charges.length} extra lesson${charges.length === 1 ? '' : 's'}`,
      ]
        .filter(Boolean)
        .join(' and ');
      await this.audit.record(tx, user, {
        action: 'invoice.void',
        entityType: 'invoice',
        entityId: id,
        summary: `${inv.number} voided${inv.status === 'PAID' ? ' (it was paid)' : ''}${back ? `, ${back} back to waiting` : ''}`,
        before: { status: inv.status },
        after: { status: row.status },
        note: reason,
      });
      // Billing only the lessons taken: the credits of the lessons that were
      // stopped must not come off it as well.
      if (body.billLessons !== undefined) {
        const cycleLessonIds = tx
          .select({ id: lessons.id })
          .from(lessons)
          .where(eq(lessons.cycleId, inv.cycleId));
        await tx
          .delete(lessonCredits)
          .where(
            and(
              eq(lessonCredits.status, 'PENDING'),
              inArray(lessonCredits.lessonId, cycleLessonIds),
            ),
          );
      }
      const replacement = body.reissue
        ? await this.cycles.reissueInvoice(tx, inv, user, body.billLessons)
        : null;
      await this.unpaid.moveHold(
        tx,
        inv.id,
        replacement && body.billLessons === undefined ? replacement.id : null,
      );
      return {
        ...row,
        replacement: replacement && {
          id: replacement.id,
          number: replacement.number,
          totalCents: replacement.totalCents,
        },
      };
    });
  }
}
