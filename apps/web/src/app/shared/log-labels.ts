/** Short names for the log's actions. */
export const ACTIONS: Record<string, string> = {
  'lesson.cancel': 'Lesson cancelled',
  'lesson.reschedule': 'Lesson moved',
  'lesson.transfer': 'Lesson moved to another teacher',
  'lesson.enter': 'Entered class',
  'lesson.attendance': 'Attendance settled',
  'lesson.review': 'Attendance checked',
  'lesson.extra': 'Extra lesson added',
  'lesson.notes': 'Lesson notes',
  'homework.send': 'Homework answer',
  'homework.check': 'Homework checked',
  'homework.file': 'Homework file',
  'invoice.pay': 'Invoice paid',
  'invoice.void': 'Invoice voided',
  'invoice.reissue': 'Invoice re-issued',
  'teacher.payout': 'Teacher paid',
  'teacher.payout-undo': 'Teacher payment undone',
  'student.import': 'Students imported',
  'teacher.import': 'Teachers imported',
  'student.create': 'Student added',
  'student.update': 'Student changed',
  'teacher.create': 'Teacher added',
  'teacher.update': 'Teacher changed',
  'teacher.availability': 'Teacher hours changed',
  'teacher.bank': 'Payment details changed',
  'teacher.note': 'Note added',
  'teacher.note-remove': 'Note removed',
  'staff.create': 'Staff added',
  'staff.update': 'Staff changed',
  'cycle.create': 'New cycle',
  'request.create': 'Request sent',
  'request.approve': 'Request approved',
  'request.decline': 'Request declined',
  'request.withdraw': 'Request withdrawn',
  'subscription.create': 'Subscription started',
  'subscription.update': 'Subscription changed',
  'subscription.transfer': 'Moved to another teacher',
  'subscription.pause': 'Subscription paused',
  'curriculum.create': 'Curriculum added',
  'curriculum.update': 'Curriculum changed',
  'plan.create': 'Plan added',
  'plan.update': 'Plan changed',
  'pay.level-rates': 'Pay by level changed',
  'settings.payment': 'Payment instructions changed',
  'user.password-reset': 'Password reset',
  'user.password': 'Password changed',
  'user.profile': 'Profile changed',
  'auth.locked': 'Sign-in paused',
};

/** Friendlier names for changed fields. */
export const FIELDS: Record<string, string> = {
  fullName: 'Name',
  phone: 'Phone',
  email: 'Email',
  timezone: 'Time zone',
  status: 'Status',
  level: 'Level',
  zoomLink: 'Meeting link',
  bio: 'Notes',
  isActive: 'Sign-in on',
  role: 'Role',
  priceCents: 'Price (cents)',
  hoursPerCycle: 'Hours a cycle',
  lessonMinutes: 'Lesson minutes',
  lessonsPerWeek: 'Lessons a week',
  cancelQuota: 'Cancel quota',
  rescheduleQuota: 'Reschedule quota',
  name: 'Name',
  areas: 'Areas',
  birthDate: 'Date of birth',
  experienceYears: 'Years of experience',
  joinedOn: 'Joined',
  gender: 'Gender',
  languages: 'Languages',
  education: 'Education',
};

export function actionLabel(action: string) {
  return ACTIONS[action] ?? action.replace(/[.-]/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/** "SCHEDULED" → "Scheduled", "TEACHER_ONLY" → "Teacher only"; other values as they are. */
export function prettyValue(value: string) {
  return /^[A-Z][A-Z_]+$/.test(value)
    ? value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ')
    : value;
}

export function fieldLabel(field: string) {
  return (
    FIELDS[field] ??
    field
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (c) => c.toUpperCase())
      .trim()
  );
}

export function roleLabel(kind: 'STUDENT' | 'TEACHER' | 'ADMIN' | 'SYSTEM') {
  return { ADMIN: 'Admin / staff', TEACHER: 'Teacher', STUDENT: 'Student', SYSTEM: 'Automatic' }[
    kind
  ];
}
