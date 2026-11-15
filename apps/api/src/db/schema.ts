/**
 * LMS data model (Drizzle ORM, PostgreSQL).
 *
 * Rules that shape it (see the decisions doc):
 * - one academy, three plans (Premium, Standard, Basic), each tied to a teacher level
 * - billing in fixed 28-day prepaid cycles; frequency = lessons per week
 * - a lesson is never edited or deleted when it moves: it gets status RESCHEDULED
 *   and the new lesson points back to it through origin_lesson_id
 * - recurring lessons are anchored to the STUDENT's time zone
 * - every change is written to audit_logs
 *
 * Money is stored in cents (integers) to avoid rounding errors.
 */
import { relations, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' });

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

// ---------- enums ----------

export const roleEnum = pgEnum('role', [
  'ADMIN',
  'STAFF',
  'TEACHER',
  'STUDENT',
]);
/** Plans and teacher levels share this scale. PREMIUM > STANDARD > BASIC. */
export const tierEnum = pgEnum('tier', ['PREMIUM', 'STANDARD', 'BASIC']);
export const studentStatusEnum = pgEnum('student_status', [
  'ACTIVE',
  'PAUSED',
  'EXITED',
]);
export const teacherStatusEnum = pgEnum('teacher_status', [
  'ACTIVE',
  'INACTIVE',
]);
export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'ACTIVE',
  'PAUSED',
  'ENDED',
]);
export const lessonTypeEnum = pgEnum('lesson_type', [
  'REGULAR',
  'FIRST_LESSON',
  'RETURNING',
  'EXTRA',
  'TRANSFERRED',
  'RESCHEDULED',
  /** a free one-off lesson to try the academy: no subscription, no invoice */
  'TRIAL',
]);
export const extraReasonEnum = pgEnum('extra_reason', ['MAKEUP', 'OTHER']);
export const lessonStatusEnum = pgEnum('lesson_status', [
  'SCHEDULED',
  'COMPLETED',
  'CANCELLED',
  'RESCHEDULED',
]);
export const actorKindEnum = pgEnum('actor_kind', [
  'STUDENT',
  'TEACHER',
  'ADMIN',
  'SYSTEM',
]);
/** Kept simple on purpose: who cancelled, and whether it was for non-payment. */
export const cancelReasonEnum = pgEnum('cancel_reason', [
  'BY_STUDENT',
  'BY_TEACHER',
  'BY_ADMIN',
  'UNPAID',
]);
export const creditStatusEnum = pgEnum('credit_status', ['PENDING', 'APPLIED']);
export const invoiceStatusEnum = pgEnum('invoice_status', [
  'OPEN',
  'PAID',
  'VOID',
]);
/**
 * Who pressed "Enter class", settled once the lesson is over:
 * BOTH = held; TEACHER_ONLY = student absent (counted, teacher paid);
 * STUDENT_ONLY = teacher missing; NONE = nobody. Staff can correct it on review.
 */
export const attendanceEnum = pgEnum('attendance', [
  'BOTH',
  'TEACHER_ONLY',
  'STUDENT_ONLY',
  'NONE',
]);
export const requestKindEnum = pgEnum('request_kind', ['CANCEL', 'RESCHEDULE']);
export const requestStatusEnum = pgEnum('request_status', [
  'OPEN',
  'APPROVED',
  'DECLINED',
  'WITHDRAWN',
]);

export type Role = (typeof roleEnum.enumValues)[number];
export type Tier = (typeof tierEnum.enumValues)[number];
export type LessonType = (typeof lessonTypeEnum.enumValues)[number];
export type LessonStatus = (typeof lessonStatusEnum.enumValues)[number];
export type ActorKind = (typeof actorKindEnum.enumValues)[number];
export type CancelReason = (typeof cancelReasonEnum.enumValues)[number];

// ---------- people ----------

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: roleEnum('role').notNull(),
  fullName: text('full_name').notNull(),
  phone: text('phone'),
  /** IANA zone, e.g. "America/New_York". Teachers and staff use "Africa/Cairo". */
  timezone: text('timezone').notNull().default('Africa/Cairo'),
  isActive: boolean('is_active').notNull().default(true),
  /** STAFF only: the parts of the academy they work on; null = all of them */
  staffAreas: text('staff_areas').array(),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const teachers = pgTable('teachers', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id),
  level: tierEnum('level').notNull(),
  status: teacherStatusEnum('status').notNull().default('ACTIVE'),
  /** Personal meeting room. A single lesson can override it. */
  zoomLink: text('zoom_link'),
  bio: text('bio'),
  /** This teacher's own pay per hour, in cents. Admins only. null = use the level's rate. */
  hourlyRateCents: integer('hourly_rate_cents'),
  rateCurrency: text('rate_currency').notNull().default('EGP'),
  // ----- personal details -----
  /** 'MALE' | 'FEMALE' */
  gender: text('gender'),
  birthDate: date('birth_date', { mode: 'string' }),
  /** ISO 3166 code */
  country: text('country'),
  city: text('city'),
  address: text('address'),
  /** languages they speak, e.g. "Arabic, English" */
  languages: text('languages'),
  /** degrees, ijazah, certificates */
  education: text('education'),
  experienceYears: integer('experience_years'),
  /** first day with the academy */
  joinedOn: date('joined_on', { mode: 'string' }),
});

/** How a teacher is paid. Admins only: never shown to staff or written to the log. */
export const teacherBankDetails = pgTable('teacher_bank_details', {
  teacherId: uuid('teacher_id')
    .primaryKey()
    .references(() => teachers.id, { onDelete: 'cascade' }),
  /** 'BANK' | 'INSTAPAY' | 'WALLET' | 'CASH' */
  method: text('method'),
  bankName: text('bank_name'),
  accountHolder: text('account_holder'),
  accountNumber: text('account_number'),
  iban: text('iban'),
  /** InstaPay address, e.g. name@instapay */
  instapay: text('instapay'),
  /** mobile wallet number (Vodafone Cash…) */
  wallet: text('wallet'),
  notes: text('notes'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** Staff notes about a teacher (feedback, warnings, agreements), newest first. */
export const teacherNotes = pgTable(
  'teacher_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teacherId: uuid('teacher_id')
      .notNull()
      .references(() => teachers.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id),
    body: text('body').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('teacher_notes_teacher_idx').on(t.teacherId, t.createdAt)],
);

export const students = pgTable('students', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id),
  status: studentStatusEnum('status').notNull().default('ACTIVE'),
  /** postal address, as the family gives it */
  address: text('address'),
  /** ISO 3166 country code (EG, US, GB...), separate from the time zone */
  country: text('country'),
  city: text('city'),
  gender: text('gender'),
  birthDate: date('birth_date', { mode: 'string' }),
  whatsapp: text('whatsapp'),
  /** who to talk to when the student is a child */
  guardianName: text('guardian_name'),
  guardianRelation: text('guardian_relation'),
  guardianPhone: text('guardian_phone'),
  guardianEmail: text('guardian_email'),
  nativeLanguage: text('native_language'),
  otherLanguages: text('other_languages'),
  /** where they are in their studies, in the staff's words */
  level: text('level'),
  goals: text('goals'),
  /** how they found the academy */
  source: text('source'),
  joinedOn: date('joined_on', { mode: 'string' }),
});

/** Staff notes on a student. Students never see them. */
export const studentNotes = pgTable(
  'student_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id),
    body: text('body').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('student_notes_student_idx').on(t.studentId, t.createdAt)],
);

// ---------- catalogue ----------

export const curricula = pgTable('curricula', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
});

export const teacherCurricula = pgTable(
  'teacher_curricula',
  {
    teacherId: uuid('teacher_id')
      .notNull()
      .references(() => teachers.id, { onDelete: 'cascade' }),
    curriculumId: uuid('curriculum_id')
      .notNull()
      .references(() => curricula.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.teacherId, t.curriculumId] })],
);

export const plans = pgTable('plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  tier: tierEnum('tier').notNull().unique(),
  /** Price of ONE lesson in cents. Invoice = price x lessons/week x 4 + extra lessons - credits. */
  priceCents: integer('price_cents').notNull(),
  currency: text('currency').notNull().default('USD'),
  /** null = unlimited (Premium) */
  cancelQuota: integer('cancel_quota'),
  /** null = unlimited (Premium) */
  rescheduleQuota: integer('reschedule_quota'),
  lessonMinutes: integer('lesson_minutes').notNull().default(60),
  /** Hours of lessons a 28-day cycle gives (Basic 4, Standard 8, Premium 12). Sets the lessons a week. */
  hoursPerCycle: integer('hours_per_cycle').notNull(),
  isActive: boolean('is_active').notNull().default(true),
});

/** Weekly open hours in the TEACHER's own time zone (Cairo). */
export const availabilityWindows = pgTable(
  'availability_windows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teacherId: uuid('teacher_id')
      .notNull()
      .references(() => teachers.id, { onDelete: 'cascade' }),
    /** ISO weekday: 1 = Monday ... 7 = Sunday */
    weekday: integer('weekday').notNull(),
    /** minutes after local midnight, e.g. 840 = 2:00 PM */
    startMinute: integer('start_minute').notNull(),
    /** exclusive end, up to 1440 */
    endMinute: integer('end_minute').notNull(),
  },
  (t) => [index('availability_teacher_idx').on(t.teacherId)],
);

// ---------- subscriptions & cycles ----------

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id),
    teacherId: uuid('teacher_id')
      .notNull()
      .references(() => teachers.id),
    curriculumId: uuid('curriculum_id')
      .notNull()
      .references(() => curricula.id),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id),
    lessonsPerWeek: integer('lessons_per_week').notNull(),
    /** The zone the weekly slots are anchored to (the student's zone at signup). */
    timezone: text('timezone').notNull(),
    /** Day 1 of cycle 1, a local date in `timezone`. */
    startDate: date('start_date', { mode: 'string' }).notNull(),
    status: subscriptionStatusEnum('status').notNull().default('ACTIVE'),
    /**
     * Set while the lessons are stopped for this unpaid invoice (after the two
     * lessons of grace). Paying the invoice clears it and books the lessons again.
     */
    heldForInvoiceId: uuid('held_for_invoice_id').references(
      (): AnyPgColumn => invoices.id,
    ),
    heldAt: ts('held_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('subscriptions_student_idx').on(t.studentId),
    index('subscriptions_teacher_idx').on(t.teacherId),
  ],
);

/** A recurring lesson time on the student's clock. */
export const weeklySlots = pgTable('weekly_slots', {
  id: uuid('id').primaryKey().defaultRandom(),
  subscriptionId: uuid('subscription_id')
    .notNull()
    .references(() => subscriptions.id, { onDelete: 'cascade' }),
  /** ISO weekday in the subscription's time zone */
  weekday: integer('weekday').notNull(),
  /** "HH:mm" local time in the subscription's time zone */
  startTime: text('start_time').notNull(),
});

/** 28 days, prepaid. Quotas reset with every cycle. */
export const billingCycles = pgTable(
  'billing_cycles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => subscriptions.id, { onDelete: 'cascade' }),
    index: integer('index').notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    /** inclusive: startDate + 27 days */
    endDate: date('end_date', { mode: 'string' }).notNull(),
    cancelsUsed: integer('cancels_used').notNull().default(0),
    reschedulesUsed: integer('reschedules_used').notNull().default(0),
  },
  (t) => [unique('billing_cycles_sub_index').on(t.subscriptionId, t.index)],
);

// ---------- lessons ----------

export const lessons = pgTable(
  'lessons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subscriptionId: uuid('subscription_id').references(() => subscriptions.id),
    cycleId: uuid('cycle_id').references(() => billingCycles.id),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id),
    teacherId: uuid('teacher_id')
      .notNull()
      .references(() => teachers.id),
    curriculumId: uuid('curriculum_id')
      .notNull()
      .references(() => curricula.id),
    /** UTC instant */
    startsAt: ts('starts_at').notNull(),
    durationMin: integer('duration_min').notNull().default(60),
    type: lessonTypeEnum('type').notNull().default('REGULAR'),
    extraReason: extraReasonEnum('extra_reason'),
    status: lessonStatusEnum('status').notNull().default('SCHEDULED'),
    /** overrides the teacher's room for this lesson only */
    zoomLink: text('zoom_link'),
    /** set on lessons created by a reschedule or a transfer, and on a makeup (the lesson it replaces) */
    originLessonId: uuid('origin_lesson_id').references(
      (): AnyPgColumn => lessons.id,
    ),
    cancelReason: cancelReasonEnum('cancel_reason'),
    cancelledBy: actorKindEnum('cancelled_by'),
    cancelledAt: ts('cancelled_at'),
    /** late cancel or no quota left: billed as taken */
    countedAsTaken: boolean('counted_as_taken').notNull().default(false),
    /** cancelled by the teacher with a makeup chosen, and no makeup booked yet */
    makeupOwed: boolean('makeup_owed').notNull().default(false),
    /** "Enter class" presses. Both set = COMPLETED. */
    teacherJoinedAt: ts('teacher_joined_at'),
    studentJoinedAt: ts('student_joined_at'),
    /** set by the close job after the lesson ends; null = not settled yet */
    attendance: attendanceEnum('attendance'),
    closedAt: ts('closed_at'),
    /** staff looked at a lesson that was not attended by both */
    reviewedAt: ts('reviewed_at'),
    reviewedById: uuid('reviewed_by_id').references(() => users.id),
    /** the email reminder before the lesson went out (or was skipped) */
    reminderSentAt: ts('reminder_sent_at'),
    notes: text('notes'),
    homeworkTitle: text('homework_title'),
    homeworkBody: text('homework_body'),
    /** the student's answer, and when they sent it (they can change it until it is checked) */
    homeworkAnswer: text('homework_answer'),
    homeworkSentAt: ts('homework_sent_at'),
    /** the teacher's feedback on the answer */
    homeworkFeedback: text('homework_feedback'),
    homeworkCheckedAt: ts('homework_checked_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('lessons_teacher_starts_idx').on(t.teacherId, t.startsAt),
    index('lessons_student_starts_idx').on(t.studentId, t.startsAt),
    index('lessons_starts_idx').on(t.startsAt),
    index('lessons_to_close_idx').on(t.closedAt, t.startsAt),
  ],
);

// ---------- billing ----------

/** Gives invoices readable numbers: INV-0001, INV-0002, ... */
export const invoiceNumberSeq = pgSequence('invoice_number_seq', {
  startWith: 1,
});

/**
 * One live invoice per cycle. A void invoice stays for the record; admin may
 * issue a new one for the same cycle, which points back to it.
 */
export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: text('number').notNull().unique(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id),
    cycleId: uuid('cycle_id')
      .notNull()
      .references(() => billingCycles.id),
    lessonsCount: integer('lessons_count').notNull(),
    creditsCount: integer('credits_count').notNull(),
    /** extra lessons (not makeups) charged on this invoice */
    extraCount: integer('extra_count').notNull().default(0),
    billedLessons: integer('billed_lessons').notNull(),
    priceCents: integer('price_cents').notNull(),
    totalCents: integer('total_cents').notNull(),
    currency: text('currency').notNull(),
    status: invoiceStatusEnum('status').notNull().default('OPEN'),
    issuedAt: ts('issued_at').notNull().defaultNow(),
    paidAt: ts('paid_at'),
    /** how the money came in (see PAYMENT_METHODS), set when marked paid */
    paymentMethod: text('payment_method'),
    paymentReference: text('payment_reference'),
    /** the Cairo day the money arrived */
    receivedOn: date('received_on', { mode: 'string' }),
    paymentNote: text('payment_note'),
    paidById: uuid('paid_by_id').references(() => users.id),
    voidedAt: ts('voided_at'),
    voidedById: uuid('voided_by_id').references(() => users.id),
    voidReason: text('void_reason'),
    /** the void invoice this one was issued to replace */
    replacesId: uuid('replaces_id').references((): AnyPgColumn => invoices.id),
  },
  (t) => [
    uniqueIndex('invoices_one_live_per_cycle_idx')
      .on(t.cycleId)
      .where(sql`status <> 'VOID'`),
  ],
);

/** One credit per lesson the student shouldn't pay for. Applied on the next invoice. */
export const lessonCredits = pgTable(
  'lesson_credits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id),
    lessonId: uuid('lesson_id')
      .notNull()
      .unique()
      .references(() => lessons.id),
    status: creditStatusEnum('status').notNull().default('PENDING'),
    invoiceId: uuid('invoice_id').references(() => invoices.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('lesson_credits_student_status_idx').on(t.studentId, t.status)],
);

/**
 * An extra lesson (not a makeup) costs one lesson at the plan price. It goes on
 * the invoice of its cycle while that is still unpaid, otherwise on the next one.
 */
export const lessonCharges = pgTable(
  'lesson_charges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id),
    lessonId: uuid('lesson_id')
      .notNull()
      .unique()
      .references(() => lessons.id),
    status: creditStatusEnum('status').notNull().default('PENDING'),
    invoiceId: uuid('invoice_id').references(() => invoices.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('lesson_charges_student_status_idx').on(t.studentId, t.status)],
);

/**
 * A teacher's pay for one month (Cairo), recorded when the academy pays it.
 * The figures are frozen at that moment; the pay page shows when the
 * month's lessons changed afterwards.
 */
export const teacherPayouts = pgTable(
  'teacher_payouts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teacherId: uuid('teacher_id')
      .notNull()
      .references(() => teachers.id),
    /** YYYY-MM */
    month: text('month').notNull(),
    lessons: integer('lessons').notNull(),
    minutes: integer('minutes').notNull(),
    rateCents: integer('rate_cents').notNull(),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull(),
    paidAt: ts('paid_at').notNull().defaultNow(),
    paidById: uuid('paid_by_id')
      .notNull()
      .references(() => users.id),
    note: text('note'),
  },
  (t) => [
    uniqueIndex('teacher_payouts_teacher_month_idx').on(t.teacherId, t.month),
  ],
);

/**
 * Files a student attaches to a homework answer: a photo of the page, a PDF or
 * a recording. Kept in the database (small, a few per answer), so there is no
 * separate file storage to set up.
 */
export const homeworkFiles = pgTable(
  'homework_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => lessons.id),
    uploadedById: uuid('uploaded_by_id')
      .notNull()
      .references(() => users.id),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    data: bytea('data').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('homework_files_lesson_idx').on(t.lessonId)],
);

/**
 * Books and other PDFs for a curriculum (the course book, a workbook...).
 * Staff upload them; the curriculum's teachers and students can open them.
 */
export const curriculumFiles = pgTable(
  'curriculum_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    curriculumId: uuid('curriculum_id')
      .notNull()
      .references(() => curricula.id, { onDelete: 'cascade' }),
    /** shown to people, e.g. "Student book" */
    title: text('title').notNull(),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    data: bytea('data').notNull(),
    uploadedById: uuid('uploaded_by_id').references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('curriculum_files_curriculum_idx').on(t.curriculumId)],
);

export const applicationStatusEnum = pgEnum('application_status', [
  'NEW',
  'CONTACTED',
  'TRIAL_BOOKED',
  'CONVERTED',
  'REJECTED',
]);

/**
 * Someone who applied on the academy's website. Staff follow up, book a
 * trial and turn them into a student.
 */
export const applications = pgTable(
  'applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    status: applicationStatusEnum('status').notNull().default('NEW'),
    fullName: text('full_name').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    country: text('country'),
    timezone: text('timezone'),
    /** the curriculum or course they asked about, as they wrote it */
    curriculum: text('curriculum'),
    /** days and times that suit them, as they wrote it */
    preferredTimes: text('preferred_times'),
    /** "for my 9-year-old", level... */
    studentAge: text('student_age'),
    level: text('level'),
    message: text('message'),
    /** the page they applied on, and campaign tags (utm_*) */
    source: text('source'),
    utm: text('utm'),
    /** staff notes, not shown to the applicant */
    notes: text('notes'),
    studentId: uuid('student_id').references(() => students.id),
    handledAt: ts('handled_at'),
    handledById: uuid('handled_by_id').references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('applications_status_idx').on(t.status, t.createdAt)],
);

/** Academy-wide text an admin can change, e.g. how families pay. */
export const academySettings = pgTable('academy_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  updatedById: uuid('updated_by_id').references(() => users.id),
});

/**
 * Pay per hour for each teacher level (Premium, Standard, Basic). A teacher
 * without their own rate is paid their level's rate.
 */
export const levelPayRates = pgTable('level_pay_rates', {
  level: tierEnum('level').primaryKey(),
  hourlyRateCents: integer('hourly_rate_cents').notNull(),
  currency: text('currency').notNull().default('EGP'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  updatedById: uuid('updated_by_id').references(() => users.id),
});

// ---------- notifications ----------

/** The bell: one line for one person. `dedupKey` keeps a job from repeating itself. */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** a page in the app to open */
    link: text('link'),
    dedupKey: text('dedup_key'),
    readAt: ts('read_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('notifications_user_idx').on(t.userId, t.createdAt),
    unique('notifications_user_dedup').on(t.userId, t.dedupKey),
  ],
);

// ---------- requests ----------

/**
 * A student or teacher asking the academy to cancel or move a lesson they
 * can't change online (too late, no quota left, or a teacher's request).
 * Staff approve (which runs the change) or decline with a note the requester sees.
 */
export const changeRequests = pgTable(
  'change_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => lessons.id),
    kind: requestKindEnum('kind').notNull(),
    status: requestStatusEnum('status').notNull().default('OPEN'),
    requestedById: uuid('requested_by_id')
      .notNull()
      .references(() => users.id),
    requesterKind: actorKindEnum('requester_kind').notNull(),
    message: text('message').notNull(),
    /** for a move: times that suit the requester, in their own words */
    preferredTimes: text('preferred_times'),
    createdAt: ts('created_at').notNull().defaultNow(),
    resolvedById: uuid('resolved_by_id').references(() => users.id),
    resolvedAt: ts('resolved_at'),
    /** shown to the requester */
    resolutionNote: text('resolution_note'),
    /** the new lesson when a move was approved */
    resultLessonId: uuid('result_lesson_id').references(() => lessons.id),
  },
  (t) => [
    index('change_requests_status_idx').on(t.status, t.createdAt),
    index('change_requests_requester_idx').on(t.requestedById, t.createdAt),
    // One open request per lesson at a time.
    uniqueIndex('change_requests_one_open_idx')
      .on(t.lessonId)
      .where(sql`status = 'OPEN'`),
  ],
);

// ---------- email ----------

export const emailStatusEnum = pgEnum('email_status', [
  'PENDING',
  'SENT',
  'FAILED',
  'SKIPPED',
]);

/**
 * Every email the system sends. Written in the same transaction as the
 * change it is about, then sent by a job a moment later (so a change that
 * is rolled back sends nothing). The body is cleared once it is handled.
 */
export const emailOutbox = pgTable(
  'email_outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    to: text('to').notNull(),
    /** what it is about, e.g. password-reset, lesson-reminder, invoice */
    kind: text('kind').notNull(),
    subject: text('subject').notNull(),
    text: text('text'),
    html: text('html'),
    status: emailStatusEnum('status').notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    createdAt: ts('created_at').notNull().defaultNow(),
    sentAt: ts('sent_at'),
  },
  (t) => [index('email_outbox_status_idx').on(t.status, t.createdAt)],
);

/** A "forgot password" link. Only a hash of the token is kept. */
export const passwordResets = pgTable(
  'password_resets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('password_resets_user_idx').on(t.userId, t.createdAt)],
);

// ---------- audit ----------

/** Append-only. The app never updates or deletes rows here. */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    at: ts('at').notNull().defaultNow(),
    actorId: uuid('actor_id').references(() => users.id),
    actorKind: actorKindEnum('actor_kind').notNull(),
    /** e.g. "lesson.cancel", "lesson.reschedule", "invoice.pay" */
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    summary: text('summary').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    /** true when an admin went past a rule */
    override: boolean('override').notNull().default(false),
    note: text('note'),
  },
  (t) => [
    index('audit_at_idx').on(t.at),
    index('audit_entity_idx').on(t.entityType, t.entityId),
    index('audit_actor_idx').on(t.actorId),
  ],
);

// ---------- relations (for db.query.*) ----------

export const usersRelations = relations(users, ({ one }) => ({
  teacher: one(teachers, { fields: [users.id], references: [teachers.userId] }),
  student: one(students, { fields: [users.id], references: [students.userId] }),
}));

export const teachersRelations = relations(teachers, ({ one, many }) => ({
  user: one(users, { fields: [teachers.userId], references: [users.id] }),
  curricula: many(teacherCurricula),
  availability: many(availabilityWindows),
  subscriptions: many(subscriptions),
  lessons: many(lessons),
}));

export const studentsRelations = relations(students, ({ one, many }) => ({
  user: one(users, { fields: [students.userId], references: [users.id] }),
  subscriptions: many(subscriptions),
  lessons: many(lessons),
  invoices: many(invoices),
  credits: many(lessonCredits),
}));

export const curriculaRelations = relations(curricula, ({ many }) => ({
  teachers: many(teacherCurricula),
}));

export const teacherCurriculaRelations = relations(
  teacherCurricula,
  ({ one }) => ({
    teacher: one(teachers, {
      fields: [teacherCurricula.teacherId],
      references: [teachers.id],
    }),
    curriculum: one(curricula, {
      fields: [teacherCurricula.curriculumId],
      references: [curricula.id],
    }),
  }),
);

export const availabilityRelations = relations(
  availabilityWindows,
  ({ one }) => ({
    teacher: one(teachers, {
      fields: [availabilityWindows.teacherId],
      references: [teachers.id],
    }),
  }),
);

export const subscriptionsRelations = relations(
  subscriptions,
  ({ one, many }) => ({
    student: one(students, {
      fields: [subscriptions.studentId],
      references: [students.id],
    }),
    teacher: one(teachers, {
      fields: [subscriptions.teacherId],
      references: [teachers.id],
    }),
    curriculum: one(curricula, {
      fields: [subscriptions.curriculumId],
      references: [curricula.id],
    }),
    plan: one(plans, {
      fields: [subscriptions.planId],
      references: [plans.id],
    }),
    slots: many(weeklySlots),
    cycles: many(billingCycles),
  }),
);

export const weeklySlotsRelations = relations(weeklySlots, ({ one }) => ({
  subscription: one(subscriptions, {
    fields: [weeklySlots.subscriptionId],
    references: [subscriptions.id],
  }),
}));

export const billingCyclesRelations = relations(
  billingCycles,
  ({ one, many }) => ({
    subscription: one(subscriptions, {
      fields: [billingCycles.subscriptionId],
      references: [subscriptions.id],
    }),
    /** the live one plus any void ones it replaced */
    invoices: many(invoices),
  }),
);

export const lessonsRelations = relations(lessons, ({ one }) => ({
  student: one(students, {
    fields: [lessons.studentId],
    references: [students.id],
  }),
  teacher: one(teachers, {
    fields: [lessons.teacherId],
    references: [teachers.id],
  }),
  curriculum: one(curricula, {
    fields: [lessons.curriculumId],
    references: [curricula.id],
  }),
  subscription: one(subscriptions, {
    fields: [lessons.subscriptionId],
    references: [subscriptions.id],
  }),
  cycle: one(billingCycles, {
    fields: [lessons.cycleId],
    references: [billingCycles.id],
  }),
}));

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  student: one(students, {
    fields: [invoices.studentId],
    references: [students.id],
  }),
  cycle: one(billingCycles, {
    fields: [invoices.cycleId],
    references: [billingCycles.id],
  }),
  credits: many(lessonCredits),
}));

export const lessonCreditsRelations = relations(lessonCredits, ({ one }) => ({
  student: one(students, {
    fields: [lessonCredits.studentId],
    references: [students.id],
  }),
  lesson: one(lessons, {
    fields: [lessonCredits.lessonId],
    references: [lessons.id],
  }),
  invoice: one(invoices, {
    fields: [lessonCredits.invoiceId],
    references: [invoices.id],
  }),
}));

export const changeRequestsRelations = relations(changeRequests, ({ one }) => ({
  lesson: one(lessons, {
    fields: [changeRequests.lessonId],
    references: [lessons.id],
  }),
  requestedBy: one(users, {
    fields: [changeRequests.requestedById],
    references: [users.id],
  }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  actor: one(users, { fields: [auditLogs.actorId], references: [users.id] }),
}));
