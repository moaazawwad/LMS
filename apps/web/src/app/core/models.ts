/** Shapes returned by the API (apps/api). */

export type Role = 'ADMIN' | 'STAFF' | 'TEACHER' | 'STUDENT';
export type Tier = 'PREMIUM' | 'STANDARD' | 'BASIC';
export type LessonStatus = 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'RESCHEDULED';
export type LessonType =
  'REGULAR' | 'FIRST_LESSON' | 'RETURNING' | 'EXTRA' | 'TRANSFERRED' | 'RESCHEDULED' | 'TRIAL';
export type CancelReason = 'BY_STUDENT' | 'BY_TEACHER' | 'BY_ADMIN' | 'UNPAID';

/** The parts of the academy a staff account can be given (admins have all). */
export type StaffArea = 'students' | 'teachers' | 'lessons' | 'billing' | 'catalog' | 'logs';

export const STAFF_AREAS: { area: StaffArea; label: string; hint: string }[] = [
  { area: 'students', label: 'Students', hint: 'add and edit students and subscriptions' },
  { area: 'teachers', label: 'Teachers', hint: 'add and edit teachers and their hours' },
  {
    area: 'lessons',
    label: 'Lessons & requests',
    hint: 'cancel or move lessons, extra lessons, attendance, requests',
  },
  { area: 'billing', label: 'Invoices', hint: 'invoices, payments and CSV downloads' },
  { area: 'catalog', label: 'Curricula', hint: 'add and rename curricula' },
  { area: 'logs', label: 'Activity', hint: 'see who did what, on each page' },
];

export interface AuthUser {
  userId: string;
  role: Role;
  fullName: string;
  timezone: string;
  teacherId?: string;
  studentId?: string;
  /** staff only; null or missing = every area */
  areas?: StaffArea[] | null;
}

export interface Lesson {
  id: string;
  startsAt: string;
  durationMin: number;
  type: LessonType;
  extraReason: 'MAKEUP' | 'OTHER' | null;
  status: LessonStatus;
  cancelReason: CancelReason | null;
  countedAsTaken: boolean;
  originLessonId: string | null;
  teacherJoinedAt: string | null;
  studentJoinedAt: string | null;
  subscriptionId: string | null;
  student: { id: string; name: string; timezone: string };
  teacher: { id: string; name: string };
  curriculum: string;
  plan: Tier | null;
  notes: string | null;
  homeworkTitle: string | null;
  homeworkBody: string | null;
  /** the student's answer, when sent (they can change it until it is checked) */
  homeworkAnswer: string | null;
  homeworkSentAt: string | null;
  /** the teacher's reply */
  homeworkFeedback: string | null;
  homeworkCheckedAt: string | null;
  canEnter: boolean;
  missed: boolean;
  /** upcoming: minutes later (+) or earlier (-) on the Cairo clock than today, because of a clock change */
  clockShiftMin: number;
  /** settled after the lesson ends; null until then */
  attendance: Attendance | null;
  /** the teacher cancelled; a makeup lesson is still to be booked */
  makeupOwed: boolean;
  /** staff only: null = not settled yet */
  teacherPaid?: boolean | null;
  /** staff only: someone did not enter and nobody has checked yet */
  needsReview?: boolean;
  /** staff only: what can be recorded about it */
  reviewOptions?: ReviewOutcome[];
  /** single lesson, teacher and staff: the teacher's cancellations in this lesson's month */
  teacherCancels?: { used: number; limit: number; month: string };
  /** staff lists, moved-away lessons: where they went */
  movedTo?: { id: string; startsAt: string; teacher: string };
}

/** GET /api/lessons/:id/history (staff) */
export interface LessonHistory {
  meetingLink: string | null;
  createdAt: string;
  cancelledAt: string | null;
  cancelledBy: 'STUDENT' | 'TEACHER' | 'ADMIN' | 'SYSTEM' | null;
  closedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  movedFrom: {
    id: string;
    startsAt: string;
    status: LessonStatus;
    type: LessonType;
    teacher: string;
  } | null;
  movedTo: {
    id: string;
    startsAt: string;
    status: LessonStatus;
    type: LessonType;
    teacher: string;
  }[];
  invoice: { id: string; number: string; status: 'OPEN' | 'PAID' | 'VOID' } | null;
  credit: { status: string; invoiceId: string | null; invoice: string | null } | null;
  charge: { status: string; invoiceId: string | null; invoice: string | null } | null;
}

/** Who pressed Enter class: both, only the teacher (student absent), only the student, nobody. */
export type Attendance = 'BOTH' | 'TEACHER_ONLY' | 'STUDENT_ONLY' | 'NONE';
export type ReviewOutcome =
  'CONFIRM' | 'HELD' | 'STUDENT_ABSENT' | 'NOBODY_CAME' | 'TEACHER_ABSENT';

/** GET /api/stats/teacher-lessons: one row per teacher. */
export interface TeacherLessonsRow {
  teacherId: string;
  name: string;
  /** admins only */
  rateCents?: number | null;
  currency?: string;
  payCents?: number | null;
  held: number;
  studentAbsent: number;
  paid: number;
  paidMinutes: number;
  notPaid: number;
  toCheck: number;
}

/** GET /api/payouts: a teacher's month recorded as paid (admins only) */
export interface Payout {
  id: string;
  teacherId: string;
  teacherName: string;
  /** YYYY-MM */
  month: string;
  lessons: number;
  minutes: number;
  rateCents: number;
  amountCents: number;
  currency: string;
  paidAt: string;
  note: string | null;
}

export interface StudentRow {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  phone: string | null;
  subscriptionId: string | null;
  timezone: string;
  status: 'ACTIVE' | 'PAUSED' | 'EXITED';
  plan: Tier | null;
  lessonsPerWeek: number | null;
  teacher: string | null;
}

export interface Slot {
  weekday: number;
  startTime: string;
}

export interface StudentOverview {
  subscription: {
    id: string;
    timezone: string;
    lessonsPerWeek: number;
    curriculum: string;
    teacher: string;
    teacherId: string;
    /** the teacher's meeting room link (null if not set) */
    teacherLink: string | null;
    plan: { name: string; tier: Tier; cancelQuota: number | null; rescheduleQuota: number | null };
    slots: Slot[];
  } | null;
  cycle: {
    index: number;
    startDate: string;
    endDate: string;
    cancelsUsed: number;
    reschedulesUsed: number;
  } | null;
  pendingCredits: number;
  upcoming: {
    id: string;
    startsAt: string;
    durationMin: number;
    type: LessonType;
    teacher: string;
    canEnter: boolean;
  }[];
  lastLesson: {
    id: string;
    startsAt: string;
    notes: string | null;
    homeworkTitle: string | null;
    homeworkBody: string | null;
    homeworkSentAt: string | null;
    homeworkCheckedAt: string | null;
  } | null;
}

export interface TeacherRow {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  phone: string | null;
  level: Tier;
  status: 'ACTIVE' | 'INACTIVE';
  curricula: string[];
  curriculumIds: string[];
}

export interface TeacherDetail {
  id: string;
  userId: string;
  /** false = sign-in turned off by staff */
  signInActive: boolean;
  bio: string | null;
  fullName: string;
  email: string;
  phone: string | null;
  timezone: string;
  level: Tier;
  status: 'ACTIVE' | 'INACTIVE';
  zoomLink: string | null;
  curricula: { id: string; name: string }[];
  availability: { weekday: number; startMinute: number; endMinute: number }[];
  students: {
    subscriptionId: string;
    studentId: string;
    fullName: string;
    email: string;
    country: string | null;
    timezone: string;
    plan: Tier;
    planName: string;
    curriculum: string;
    startDate: string;
    lessonsPerWeek: number;
    slots: Slot[];
  }[];
  // personal details
  gender: 'MALE' | 'FEMALE' | null;
  birthDate: string | null;
  country: string | null;
  city: string | null;
  address: string | null;
  languages: string | null;
  education: string | null;
  experienceYears: number | null;
  joinedOn: string | null;
  /** lessons the teacher cancelled (or missed) this Cairo month */
  cancelsThisMonth: { used: number; limit: number; month: string };
  /** admins only: the teacher's own pay per hour, in cents (null = use the level's rate) */
  hourlyRateCents?: number | null;
  rateCurrency?: string;
  /** admins only: what they are actually paid */
  payRate?: PayRate;
}

/** The personal details a teacher's profile keeps (all optional). */
export interface TeacherProfileFields {
  gender?: string | null;
  birthDate?: string | null;
  country?: string | null;
  city?: string | null;
  address?: string | null;
  languages?: string | null;
  education?: string | null;
  experienceYears?: number | null;
  joinedOn?: string | null;
}

export type PayoutMethod = 'BANK' | 'INSTAPAY' | 'WALLET' | 'CASH';

/** How a teacher is paid (admins only). */
export interface TeacherBank {
  method: PayoutMethod | null;
  bankName: string | null;
  accountHolder: string | null;
  accountNumber: string | null;
  iban: string | null;
  instapay: string | null;
  wallet: string | null;
  notes: string | null;
  updatedAt: string | null;
}

/** A note staff wrote about a teacher. */
export interface TeacherNote {
  id: string;
  body: string;
  createdAt: string;
  authorId: string | null;
  authorName: string | null;
}

/** A teacher's last 6 Cairo months, newest first, and what went wrong when. */
export interface TeacherRecord {
  months: {
    month: string;
    label: string;
    held: number;
    heldMinutes: number;
    studentAbsent: number;
    noShow: number;
    cancelled: number;
    nobodyCame: number;
  }[];
  incidents: {
    lessonId: string;
    startsAt: string;
    kind: 'NO_SHOW' | 'CANCELLED' | 'NOBODY_CAME';
    studentId: string;
    studentName: string;
    makeupOwed: boolean;
  }[];
}

/** A teacher's rate is their own when set, otherwise their level's. */
export interface PayRate {
  rateCents: number | null;
  currency: string;
  source: 'TEACHER' | 'LEVEL' | null;
}

/** Pay per hour for one teacher level (admins only). */
export interface LevelPayRate {
  level: Tier;
  hourlyRateCents: number | null;
  currency: string;
  /** active teachers at this level */
  teachers: number;
  /** of them, paid their own rate instead */
  ownRate: number;
}

export interface Invoice {
  id: string;
  number: string;
  status: 'OPEN' | 'PAID' | 'VOID';
  studentId: string;
  studentName: string;
  cycleIndex: number;
  cycleStart: string;
  cycleEnd: string;
  lessonsCount: number;
  creditsCount: number;
  extraCount: number;
  billedLessons: number;
  priceCents: number;
  totalCents: number;
  currency: string;
  issuedAt: string;
  paidAt: string | null;
  paymentMethod: PaymentMethod | null;
  paymentReference: string | null;
  /** the Cairo day the money arrived */
  receivedOn: string | null;
  voidedAt: string | null;
  /** the void invoice this one replaced */
  replacesId: string | null;
  /** due and its cycle has started (prepaid) */
  overdue: boolean;
  /** the student's lessons are stopped until this one is paid (staff only) */
  onHold: boolean;
}

export const PAYMENT_METHODS = [
  'BANK_TRANSFER',
  'INSTAPAY',
  'WALLET',
  'CARD',
  'PAYPAL',
  'CASH',
  'OTHER',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  BANK_TRANSFER: 'Bank transfer',
  INSTAPAY: 'InstaPay',
  WALLET: 'Mobile wallet',
  CARD: 'Card',
  PAYPAL: 'PayPal',
  CASH: 'Cash',
  OTHER: 'Other',
};

/** Where an unpaid invoice stands: two lessons of grace, then the lessons stop. */
export interface InvoiceStanding {
  dueDate: string;
  overdue: boolean;
  lessonsTaken: number;
  graceLessons: number;
  lessonsLeftBeforeHold: number;
  onHold: boolean;
  /** lessons taken off the calendar because the invoice is unpaid */
  lessonsRemoved: number;
}

/** GET /api/invoices/due: what the signed-in student owes */
export interface DueInvoice {
  id: string;
  number: string;
  totalCents: number;
  currency: string;
  cycleStart: string;
  cycleEnd: string;
  dueDate: string;
  overdue: boolean;
  lessonsTaken: number;
  lessonsLeftBeforeHold: number;
  onHold: boolean;
}

/** What paying an invoice brought back, when lessons were on hold for it. */
export interface PayResult extends Invoice {
  resumed: {
    subscriptionId: string;
    restored: number;
    credited: number;
    /** false: the cycle is over, the student needs new weekly lessons */
    active: boolean;
  } | null;
}

/** One line under the bell. */
export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

/** GET /api/invoices/summary: all time, by status */
export interface InvoiceSummary {
  open: { count: number; totals: { currency: string; cents: number }[] };
  paid: { count: number; totals: { currency: string; cents: number }[] };
  void: { count: number; totals: { currency: string; cents: number }[] };
  /** the most rows the list returns at once */
  listLimit: number;
}

export interface AuditEntry {
  id: string;
  at: string;
  actorKind: 'STUDENT' | 'TEACHER' | 'ADMIN' | 'SYSTEM';
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  override: boolean;
  note: string | null;
  /** who the entry is about */
  about: {
    student?: { id: string; name: string };
    teacher?: { id: string; name: string };
    user?: { id: string; name: string; role: string };
  } | null;
  /** simple fields that changed */
  changes: { field: string; from: string; to: string }[];
}

export interface FreeSlots {
  timezone: string;
  slots: { startsAt: string; local: string; cairo: string }[];
}

/** Body of a 422 from the API when a business rule blocks an action. */
export interface RuleViolationError {
  error: 'RuleViolation';
  message: string;
  violations: { code: string; message: string; at?: string }[];
  canOverride: boolean;
}

export interface StudentDetail {
  id: string;
  userId: string;
  /** false = sign-in turned off by staff */
  signInActive: boolean;
  status: 'ACTIVE' | 'PAUSED' | 'EXITED';
  fullName: string;
  email: string;
  phone: string | null;
  timezone: string;
  address: string | null;
  /** ISO 3166 code */
  country: string | null;
  createdAt?: string;
  subscriptions: {
    id: string;
    status: 'ACTIVE' | 'PAUSED' | 'ENDED';
    plan: { id: string; name: string; tier: Tier };
    teacher: { id: string; name: string };
    curriculum: string;
    lessonsPerWeek: number;
    timezone: string;
    startDate: string;
    slots: Slot[];
  }[];
}

export interface Curriculum {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
}

export interface Plan {
  id: string;
  name: string;
  tier: Tier;
  priceCents: number;
  currency: string;
  cancelQuota: number | null;
  rescheduleQuota: number | null;
  lessonMinutes: number;
  /** hours of lessons a 28-day cycle gives */
  hoursPerCycle: number;
  /** follows from the hours and the lesson length; null if they do not spread evenly */
  lessonsPerWeek: number | null;
  isActive: boolean;
}

export interface StaffMember {
  id: string;
  fullName: string;
  email: string;
  role: 'ADMIN' | 'STAFF';
  isActive: boolean;
  /** null = every area */
  areas: StaffArea[] | null;
  createdAt: string;
}

/** GET /subscriptions/:id */
export interface SubscriptionDetail {
  id: string;
  studentId: string;
  teacherId: string;
  curriculumId: string;
  planId: string;
  lessonsPerWeek: number;
  timezone: string;
  startDate: string;
  status: 'ACTIVE' | 'PAUSED' | 'ENDED';
  plan: Plan;
  curriculum: Curriculum;
  slots: (Slot & { id: string })[];
  cycles: {
    id: string;
    index: number;
    startDate: string;
    endDate: string;
    cancelsUsed: number;
    reschedulesUsed: number;
    invoice: {
      id: string;
      number: string;
      status: 'OPEN' | 'PAID' | 'VOID';
      billedLessons: number;
      totalCents: number;
      currency: string;
    } | null;
  }[];
  teacher: { id: string; level: Tier; user: { fullName: string } };
  student: { id: string; user: { fullName: string } };
}

export type RequestKind = 'CANCEL' | 'RESCHEDULE';
export type RequestStatus = 'OPEN' | 'APPROVED' | 'DECLINED' | 'WITHDRAWN';

/** A student or teacher asking the academy to cancel or move a lesson. */
export interface ChangeRequest {
  id: string;
  kind: RequestKind;
  status: RequestStatus;
  message: string;
  preferredTimes: string | null;
  createdAt: string;
  requester: { name: string; kind: 'STUDENT' | 'TEACHER' };
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  resultLessonId: string | null;
  lesson: Lesson | null;
  /** staff only: what stops the student doing it online right now */
  rules: { code: string; message: string }[];
}

/** GET /api/stats/overview */
export interface AcademyStats {
  activeStudents: number;
  activeTeachers: number;
  unpaid: { currency: string; invoices: number; totalCents: number }[];
  overdueInvoices: number;
  lessonsNext7Days: number;
  missingNotesLast7Days: number;
  attendanceToCheck: number;
  makeupsOwed: number;
  cancelledLast7Days: number;
  openRequests: number;
}

/** GET /api/invoices/:id */
export interface InvoiceDetail {
  id: string;
  number: string;
  status: 'OPEN' | 'PAID' | 'VOID';
  issuedAt: string;
  paidAt: string | null;
  currency: string;
  priceCents: number;
  lessonsCount: number;
  creditsCount: number;
  extraCount: number;
  billedLessons: number;
  totalCents: number;
  student: { id: string; name: string; email: string; timezone: string };
  plan: string;
  /** minutes per lesson (the plan's) */
  lessonMinutes: number;
  teacher: string | null;
  curriculum: string;
  cycle: { index: number; startDate: string; endDate: string };
  lessons: { startsAt: string; status: LessonStatus; type: LessonType; countedAsTaken: boolean }[];
  credits: { lessonStartsAt: string; cancelReason: CancelReason | null }[];
  /** extra lessons billed on this invoice */
  extras: { lessonStartsAt: string; status: LessonStatus }[];
  /** set when void; who and why only for staff */
  voided: { at: string | null; by: string | null; reason: string | null } | null;
  replaces: { id: string; number: string } | null;
  replacedBy: { id: string; number: string } | null;
  /** how it was paid; who recorded it and their note for staff only */
  payment: {
    method: PaymentMethod | null;
    reference: string | null;
    receivedOn: string | null;
    recordedBy: string | null;
    note: string | null;
  } | null;
  standing: InvoiceStanding;
  /** how to pay, while the invoice is due (set by the academy) */
  paymentInstructions: string | null;
}

/** GET /api/stats/monthly */
export interface MoneyLine {
  currency: string;
  count: number;
  cents: number;
}
export interface MonthlyReport {
  month: string;
  firstDay: string;
  lastDay: string;
  inProgress: boolean;
  money: { issued: MoneyLine[]; collected: MoneyLine[]; dueNow: MoneyLine[]; voided: number };
  lessons: {
    held: number;
    studentAbsent: number;
    nobodyCame: number;
    toCheck: number;
    upcoming: number;
    byStudent: number;
    byTeacher: number;
    byAcademy: number;
    unpaid: number;
    moved: number;
    extra: number;
    makeup: number;
  };
  students: { active: number; started: number };
  /** admins only */
  teacherPay: {
    owed: MoneyLine[];
    recorded: MoneyLine[];
    teachersPaid: number;
    teachers: number;
  } | null;
  trend: { month: string; collected: { currency: string; cents: number }[]; held: number }[];
}

/** A file attached to a homework answer */
export interface HomeworkFile {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
  createdAt: string;
}

/** GET /api/lessons/schedule-check */
export interface ScheduleCheck {
  from: string;
  to: string;
  clockChanges: {
    timezone: string;
    at: string;
    offsetBefore: number;
    offsetAfter: number;
    students: number | null;
  }[];
  movedLessons: number;
  problems: {
    kind: 'OUTSIDE_HOURS' | 'TEACHER_CLASH' | 'STUDENT_CLASH';
    lesson: Lesson;
    with: Lesson | null;
    clockShiftMin: number;
  }[];
}

/** A PDF book of a curriculum. */
export interface CurriculumFile {
  id: string;
  curriculumId: string;
  title: string;
  fileName: string;
  size: number;
  createdAt: string;
}

/** GET /api/my-books: books by curriculum */
export interface BookGroup {
  curriculumId: string;
  curriculum: string;
  files: CurriculumFile[];
}
