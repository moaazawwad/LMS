import { DateTime } from 'luxon';
import {
  cycleIndexFor,
  cycleRange,
  invoiceFor,
  invoiceNumber,
  lessonsPerWeekFor,
  planForLessons,
} from './billing.js';
import {
  teacherCancelCheck,
  TEACHER_CANCELS_PER_MONTH,
  attendanceOf,
  closeOutcome,
  needsReview,
  reviewOptions,
  reviewResult,
  teacherPaid,
  canEnterClass,
  cancellationOutcome,
  checkStudentChange,
  statusAfterJoin,
  teacherLevelCheck,
} from './lesson-rules.js';
import {
  fitsAvailability,
  hoursOnDay,
  formatInZone,
  freeSlotsForDay,
  occurrencesInRange,
  overlaps,
  weeklyFreeTimes,
} from './schedule.js';

const at = (iso: string) => new Date(iso);

describe('student self-service (4-hour rule + quota)', () => {
  const lesson = at('2026-10-22T13:00:00Z');
  const quotaLeft = { quota: 2, used: 1 };

  it('allows a change exactly 4 hours before', () => {
    const r = checkStudentChange({
      action: 'cancel',
      lessonStatus: 'SCHEDULED',
      startsAt: lesson,
      now: at('2026-10-22T09:00:00Z'),
      quota: quotaLeft,
    });
    expect(r.allowed).toBe(true);
  });

  it('blocks a change 3h59m before', () => {
    const r = checkStudentChange({
      action: 'reschedule',
      lessonStatus: 'SCHEDULED',
      startsAt: lesson,
      now: at('2026-10-22T09:01:00Z'),
      quota: quotaLeft,
    });
    expect(r.allowed).toBe(false);
    expect(r.violations.map((v) => v.code)).toEqual(['NOTICE_TOO_SHORT']);
  });

  it('blocks when the quota is used up', () => {
    const r = checkStudentChange({
      action: 'cancel',
      lessonStatus: 'SCHEDULED',
      startsAt: lesson,
      now: at('2026-10-20T12:00:00Z'),
      quota: { quota: 2, used: 2 },
    });
    expect(r.violations.map((v) => v.code)).toEqual(['QUOTA_EXHAUSTED']);
  });

  it('never blocks Premium on quota, but still applies the 4-hour rule', () => {
    const early = checkStudentChange({
      action: 'cancel',
      lessonStatus: 'SCHEDULED',
      startsAt: lesson,
      now: at('2026-10-20T12:00:00Z'),
      quota: { quota: null, used: 40 },
    });
    expect(early.allowed).toBe(true);
    const late = checkStudentChange({
      action: 'cancel',
      lessonStatus: 'SCHEDULED',
      startsAt: lesson,
      now: at('2026-10-22T12:00:00Z'),
      quota: { quota: null, used: 0 },
    });
    expect(late.violations.map((v) => v.code)).toEqual(['NOTICE_TOO_SHORT']);
  });

  it('only scheduled, future lessons can change', () => {
    const r = checkStudentChange({
      action: 'cancel',
      lessonStatus: 'CANCELLED',
      startsAt: lesson,
      now: at('2026-10-22T14:00:00Z'),
      quota: quotaLeft,
    });
    expect(r.violations.map((v) => v.code)).toEqual([
      'LESSON_NOT_SCHEDULED',
      'LESSON_STARTED',
    ]);
  });
});

describe('what a cancellation means', () => {
  it('student within the rules: credit and one cancel used', () => {
    expect(
      cancellationOutcome({ reason: 'BY_STUDENT', withinRules: true }),
    ).toEqual({
      credit: true,
      usesQuota: true,
      countedAsTaken: false,
      makeup: false,
    });
  });

  it('student late or out of quota: counted as taken, no credit', () => {
    expect(
      cancellationOutcome({ reason: 'BY_STUDENT', withinRules: false }),
    ).toMatchObject({
      credit: false,
      countedAsTaken: true,
    });
  });

  it('teacher: makeup or credit, never the student quota', () => {
    expect(
      cancellationOutcome({
        reason: 'BY_TEACHER',
        withinRules: true,
        teacherRemedy: 'MAKEUP',
      }),
    ).toMatchObject({
      makeup: true,
      credit: false,
      usesQuota: false,
    });
    expect(
      cancellationOutcome({
        reason: 'BY_TEACHER',
        withinRules: true,
        teacherRemedy: 'CREDIT',
      }),
    ).toMatchObject({
      credit: true,
      usesQuota: false,
    });
  });

  it('unpaid: no credit', () => {
    expect(
      cancellationOutcome({ reason: 'UNPAID', withinRules: true }).credit,
    ).toBe(false);
  });
});

describe('teacher level vs plan', () => {
  it('matches, allows higher, flags lower', () => {
    expect(teacherLevelCheck('STANDARD', 'STANDARD')).toBe('MATCH');
    expect(teacherLevelCheck('PREMIUM', 'BASIC')).toBe('HIGHER');
    expect(teacherLevelCheck('STANDARD', 'PREMIUM')).toBe('LOWER');
  });
});

describe('Enter class and attendance', () => {
  const start = at('2026-10-20T13:00:00Z');
  it('opens 10 minutes before and closes at the end', () => {
    expect(canEnterClass(start, 60, at('2026-10-20T12:49:00Z'))).toBe(false);
    expect(canEnterClass(start, 60, at('2026-10-20T12:50:00Z'))).toBe(true);
    expect(canEnterClass(start, 60, at('2026-10-20T14:00:00Z'))).toBe(true);
    expect(canEnterClass(start, 60, at('2026-10-20T14:01:00Z'))).toBe(false);
  });
  it('is completed only when both pressed Enter class', () => {
    expect(statusAfterJoin('SCHEDULED', start, null)).toBe('SCHEDULED');
    expect(statusAfterJoin('SCHEDULED', start, start)).toBe('COMPLETED');
    expect(statusAfterJoin('CANCELLED', start, start)).toBe('CANCELLED');
  });
});

describe('28-day cycles and invoices', () => {
  it('computes cycle ranges', () => {
    expect(cycleRange('2026-10-06', 1)).toEqual({
      index: 1,
      startDate: '2026-10-06',
      endDate: '2026-11-02',
    });
    expect(cycleRange('2026-10-06', 2).startDate).toBe('2026-11-03');
    expect(cycleRange('2026-10-06', 4).startDate).toBe('2026-12-29');
  });
  it('finds the cycle for a date', () => {
    expect(cycleIndexFor('2026-10-06', '2026-10-06')).toBe(1);
    expect(cycleIndexFor('2026-10-06', '2026-11-02')).toBe(1);
    expect(cycleIndexFor('2026-10-06', '2026-11-03')).toBe(2);
  });
  it('bills lessons per week x 4 minus credits', () => {
    expect(
      invoiceFor({ lessonsPerWeek: 2, priceCents: 1500, pendingCredits: 2 }),
    ).toEqual({
      lessonsCount: 8,
      extraCount: 0,
      creditsApplied: 2,
      billedLessons: 6,
      totalCents: 9000,
    });
  });
  it('adds extra lessons at the plan price', () => {
    expect(
      invoiceFor({
        lessonsPerWeek: 2,
        priceCents: 1500,
        pendingCredits: 1,
        extraLessons: 2,
      }),
    ).toEqual({
      lessonsCount: 8,
      extraCount: 2,
      creditsApplied: 1,
      billedLessons: 9,
      totalCents: 13500,
    });
  });
  it('keeps extra credits for later', () => {
    expect(
      invoiceFor({ lessonsPerWeek: 1, priceCents: 1500, pendingCredits: 6 }),
    ).toMatchObject({
      creditsApplied: 4,
      billedLessons: 0,
      totalCents: 0,
    });
  });
  it("spreads a plan's hours over the four weeks of a cycle", () => {
    expect(lessonsPerWeekFor({ hoursPerCycle: 4, lessonMinutes: 60 })).toBe(1);
    expect(lessonsPerWeekFor({ hoursPerCycle: 8, lessonMinutes: 60 })).toBe(2);
    expect(lessonsPerWeekFor({ hoursPerCycle: 12, lessonMinutes: 60 })).toBe(3);
    expect(lessonsPerWeekFor({ hoursPerCycle: 4, lessonMinutes: 30 })).toBe(2);
    // Does not spread evenly, or more than one a day.
    expect(
      lessonsPerWeekFor({ hoursPerCycle: 8, lessonMinutes: 45 }),
    ).toBeNull();
    expect(
      lessonsPerWeekFor({ hoursPerCycle: 2, lessonMinutes: 60 }),
    ).toBeNull();
    expect(
      lessonsPerWeekFor({ hoursPerCycle: 32, lessonMinutes: 60 }),
    ).toBeNull();
  });
  it('picks the plan by the hours the lessons reach', () => {
    const plans = [
      { name: 'Premium', hoursPerCycle: 12, lessonMinutes: 60 },
      { name: 'Basic', hoursPerCycle: 4, lessonMinutes: 60 },
      { name: 'Standard', hoursPerCycle: 8, lessonMinutes: 60 },
    ];
    const pick = (n: number) => planForLessons(plans, n)?.name;
    // 1 a week = 4 h, 2 = 8 h, 3 = 12 h, more stays Premium
    expect([1, 2, 3, 4, 7].map(pick)).toEqual([
      'Basic',
      'Standard',
      'Premium',
      'Premium',
      'Premium',
    ]);
    // 30-minute lessons: 1 a week is 2 h, still the smallest plan; 4 a week reach 8 h
    const half = plans.map((p) => ({ ...p, lessonMinutes: 30 }));
    expect([1, 2, 3, 4, 6].map((n) => planForLessons(half, n)?.name)).toEqual([
      'Basic',
      'Basic',
      'Basic',
      'Standard',
      'Premium',
    ]);
    expect(planForLessons([], 2)).toBeNull();
  });
  it('formats invoice numbers', () => {
    expect(invoiceNumber(147)).toBe('INV-0147');
  });
});

describe('time zones and daylight saving (student clock is the anchor)', () => {
  it('knows Egypt leaves summer time after Thu Oct 29, 2026', () => {
    expect(
      DateTime.fromISO('2026-10-29T12:00', { zone: 'Africa/Cairo' }).offset,
    ).toBe(180);
    expect(
      DateTime.fromISO('2026-10-30T12:00', { zone: 'Africa/Cairo' }).offset,
    ).toBe(120);
  });

  it('keeps a New York 9:00 AM lesson at 9:00 AM across Nov 1', () => {
    const got = occurrencesInRange({
      timezone: 'America/New_York',
      slots: [{ weekday: 2, startTime: '09:00' }],
      fromDate: '2026-10-27',
      toDate: '2026-11-03',
    });
    expect(got.map((d) => d.toISOString())).toEqual([
      '2026-10-27T13:00:00.000Z',
      '2026-11-03T14:00:00.000Z',
    ]);
    expect(
      got.map((d) => formatInZone(d, 'America/New_York', 'h:mm a')),
    ).toEqual(['9:00 AM', '9:00 AM']);
    // Cairo also moved, so it stays 4 PM in Cairo
    expect(got.map((d) => formatInZone(d, 'Africa/Cairo', 'h:mm a'))).toEqual([
      '4:00 PM',
      '4:00 PM',
    ]);
  });

  it('shows the Oct 30 - Nov 1 gap: US lessons are 1 hour earlier in Cairo', () => {
    const [sat] = occurrencesInRange({
      timezone: 'America/New_York',
      slots: [{ weekday: 6, startTime: '09:00' }],
      fromDate: '2026-10-31',
      toDate: '2026-10-31',
    });
    expect(formatInZone(sat, 'Africa/Cairo', 'h:mm a')).toBe('3:00 PM');
  });

  it('moves a Sydney evening lesson 1 hour earlier in Cairo after Oct 29', () => {
    const got = occurrencesInRange({
      timezone: 'Australia/Sydney',
      slots: [{ weekday: 3, startTime: '21:00' }],
      fromDate: '2026-10-28',
      toDate: '2026-11-04',
    });
    expect(got.map((d) => formatInZone(d, 'Africa/Cairo', 'h:mm a'))).toEqual([
      '1:00 PM',
      '12:00 PM',
    ]);
  });
});

describe('teacher availability and free slots', () => {
  // Cairo-time windows: Tue 9:00-12:00 and 15:00-23:00, Fri 15:00-20:00
  const windows = [
    { weekday: 2, startMinute: 9 * 60, endMinute: 12 * 60 },
    { weekday: 2, startMinute: 15 * 60, endMinute: 23 * 60 },
    { weekday: 5, startMinute: 15 * 60, endMinute: 20 * 60 },
  ];

  it('checks a lesson fits a window on the teacher clock', () => {
    expect(fitsAvailability(windows, at('2026-10-20T13:00:00Z'), 60)).toBe(
      true,
    ); // 4 PM Cairo
    expect(fitsAvailability(windows, at('2026-10-20T10:00:00Z'), 60)).toBe(
      false,
    ); // 1 PM Cairo
    expect(fitsAvailability(windows, at('2026-11-03T14:00:00Z'), 60)).toBe(
      true,
    ); // 4 PM Cairo after DST
  });

  it('joins back-to-back windows, also across midnight', () => {
    const split = [
      { weekday: 2, startMinute: 9 * 60, endMinute: 12 * 60 },
      { weekday: 2, startMinute: 12 * 60, endMinute: 15 * 60 },
      { weekday: 3, startMinute: 20 * 60, endMinute: 24 * 60 },
      { weekday: 4, startMinute: 0, endMinute: 2 * 60 },
      { weekday: 7, startMinute: 22 * 60, endMinute: 24 * 60 },
      { weekday: 1, startMinute: 0, endMinute: 60 },
    ];
    // Tue 11:30-12:30 Cairo spans the two Tuesday windows
    expect(fitsAvailability(split, at('2026-11-03T09:30:00Z'), 60)).toBe(true);
    // Wed 23:30 to Thu 00:30 Cairo runs over midnight
    expect(fitsAvailability(split, at('2026-11-04T21:30:00Z'), 60)).toBe(true);
    // Sun 23:30 to Mon 00:30 Cairo runs into the next week
    expect(fitsAvailability(split, at('2026-11-08T21:30:00Z'), 60)).toBe(true);
    // Thu 01:30-02:30 Cairo runs past the end
    expect(fitsAvailability(split, at('2026-11-04T23:30:00Z'), 60)).toBe(false);
  });

  it("says the teacher's hours on the lesson's day", () => {
    expect(hoursOnDay(windows, at('2026-11-03T10:00:00Z'))).toBe(
      'Tue 9:00 AM–12:00 PM, 3:00 PM–11:00 PM',
    );
    expect(hoursOnDay(windows, at('2026-11-05T10:00:00Z'))).toBeNull();
  });

  it('detects overlaps', () => {
    const a = { startsAt: at('2026-10-20T13:00:00Z'), durationMin: 60 };
    expect(
      overlaps(a, { startsAt: at('2026-10-20T13:30:00Z'), durationMin: 60 }),
    ).toBe(true);
    expect(
      overlaps(a, { startsAt: at('2026-10-20T14:00:00Z'), durationMin: 60 }),
    ).toBe(false);
  });

  it('lists free times in the student zone, minus booked lessons', () => {
    const base = {
      teacherWindows: windows,
      studentTz: 'America/New_York',
      localDate: '2026-10-23',
      durationMin: 60,
      now: at('2026-10-20T12:51:00Z'),
      minNoticeHours: 4,
    };
    const free = freeSlotsForDay({ ...base, booked: [] });
    expect(
      free.map((d) => formatInZone(d, 'America/New_York', 'h:mm a')),
    ).toEqual(['8:00 AM', '9:00 AM', '10:00 AM', '11:00 AM', '12:00 PM']);
    const withBooking = freeSlotsForDay({
      ...base,
      booked: [{ startsAt: at('2026-10-23T14:00:00Z'), durationMin: 60 }],
    });
    expect(withBooking).toHaveLength(4);
  });

  it('respects the 4-hour notice for same-day times', () => {
    const free = freeSlotsForDay({
      teacherWindows: windows,
      booked: [],
      studentTz: 'America/New_York',
      localDate: '2026-10-20',
      durationMin: 60,
      now: at('2026-10-20T12:51:00Z'),
      minNoticeHours: 4,
    });
    // Tue window 15:00-23:00 Cairo = 8 AM-4 PM New York; earliest allowed is 4:51 PM UTC = 12:51 PM NY
    expect(
      free.map((d) => formatInZone(d, 'America/New_York', 'h:mm a')),
    ).toEqual(['1:00 PM', '2:00 PM', '3:00 PM']);
  });
});

describe('weeklyFreeTimes', () => {
  // Teacher (Cairo): Tuesday 15:00-18:00 only.
  const windows = [{ weekday: 2, startMinute: 15 * 60, endMinute: 18 * 60 }];
  const base = {
    timezone: 'America/New_York',
    durationMin: 60,
    stepMin: 60,
    windows,
    busy: [] as { startsAt: Date; durationMin: number }[],
  };

  it('offers the teacher hours on the student clock, before the clocks change', () => {
    // Oct 1-28, 2026: New York is UTC-4 and Cairo UTC+3, 7 hours apart.
    const free = weeklyFreeTimes({
      ...base,
      fromDate: '2026-10-01',
      toDate: '2026-10-28',
    });
    expect(free.find((d) => d.weekday === 2)?.times).toEqual([
      '08:00',
      '09:00',
      '10:00',
    ]);
    expect(
      free.filter((d) => d.weekday !== 2).every((d) => d.times.length === 0),
    ).toBe(true);
  });

  it('drops times that stop fitting when a clock changes inside the cycle', () => {
    // Oct 20 - Nov 16: Egypt goes back on Oct 30, the US on Nov 1. After that the
    // gap is still 7 hours, but Oct 27 sits between... all four Tuesdays must fit.
    const free = weeklyFreeTimes({
      ...base,
      fromDate: '2026-10-20',
      toDate: '2026-11-16',
    });
    expect(free.find((d) => d.weekday === 2)?.times).toEqual([
      '08:00',
      '09:00',
      '10:00',
    ]);
    // A Sydney student: Sydney is already on summer time (UTC+11); Cairo goes back on Oct 30, so the gap grows from 8 to 9 hours.
    const sydney = weeklyFreeTimes({
      ...base,
      timezone: 'Australia/Sydney',
      fromDate: '2026-10-21',
      toDate: '2026-11-17',
    });
    // Tuesday 15:00-18:00 Cairo = Wednesday 00:00-03:00 Sydney after Oct 30, 23:00-02:00 before: only 00:00-01:00 works every week.
    expect(sydney.find((d) => d.weekday === 3)?.times).toEqual([
      '00:00',
      '01:00',
    ]);
  });

  it('skips times that clash with a booked lesson in any week', () => {
    const busy = [
      { startsAt: new Date('2026-10-13T13:00:00Z'), durationMin: 60 },
    ]; // Tue Oct 13, 9:00 New York
    const free = weeklyFreeTimes({
      ...base,
      busy,
      fromDate: '2026-10-01',
      toDate: '2026-10-28',
    });
    expect(free.find((d) => d.weekday === 2)?.times).toEqual([
      '08:00',
      '10:00',
    ]);
  });
});

describe('after the lesson', () => {
  const t = new Date('2026-10-20T13:00:00Z');

  it('settles attendance from the Enter class presses', () => {
    expect(attendanceOf(t, t)).toBe('BOTH');
    expect(attendanceOf(t, null)).toBe('TEACHER_ONLY');
    expect(attendanceOf(null, t)).toBe('STUDENT_ONLY');
    expect(attendanceOf(null, null)).toBe('NONE');
  });

  it('closes a lesson: student absent counts, a missing teacher waits for staff', () => {
    expect(closeOutcome('BOTH')).toEqual({
      status: 'COMPLETED',
      needsReview: false,
    });
    expect(closeOutcome('TEACHER_ONLY')).toEqual({
      status: 'COMPLETED',
      needsReview: true,
    });
    expect(closeOutcome('STUDENT_ONLY')).toEqual({
      status: 'SCHEDULED',
      needsReview: true,
    });
    expect(closeOutcome('NONE')).toEqual({
      status: 'SCHEDULED',
      needsReview: true,
    });
  });

  it('pays the teacher only when they were there', () => {
    expect(
      teacherPaid({ status: 'COMPLETED', attendance: 'BOTH', closedAt: t }),
    ).toBe(true);
    expect(
      teacherPaid({
        status: 'COMPLETED',
        attendance: 'TEACHER_ONLY',
        closedAt: t,
      }),
    ).toBe(true);
    expect(
      teacherPaid({ status: 'COMPLETED', attendance: 'NONE', closedAt: t }),
    ).toBe(false);
    expect(
      teacherPaid({
        status: 'SCHEDULED',
        attendance: 'STUDENT_ONLY',
        closedAt: t,
      }),
    ).toBe(false);
    expect(
      teacherPaid({
        status: 'CANCELLED',
        attendance: 'STUDENT_ONLY',
        closedAt: t,
      }),
    ).toBe(false);
    // Not over yet, or not settled yet.
    expect(
      teacherPaid({ status: 'SCHEDULED', attendance: null, closedAt: null }),
    ).toBeNull();
    // Both pressed before the close job ran.
    expect(
      teacherPaid({ status: 'COMPLETED', attendance: null, closedAt: null }),
    ).toBe(true);
  });

  it('offers staff only the outcomes that fit what was recorded', () => {
    expect(reviewOptions('TEACHER_ONLY')).toEqual(['CONFIRM', 'HELD']);
    expect(reviewOptions('STUDENT_ONLY')).toEqual(['HELD', 'TEACHER_ABSENT']);
    expect(reviewOptions('NONE')).toContain('NOBODY_CAME');
    expect(reviewOptions('BOTH')).toEqual([]);
    expect(reviewResult('HELD', 'NONE')).toEqual({
      status: 'COMPLETED',
      attendance: 'BOTH',
    });
    expect(reviewResult('STUDENT_ABSENT', 'NONE')).toEqual({
      status: 'COMPLETED',
      attendance: 'TEACHER_ONLY',
    });
    expect(reviewResult('NOBODY_CAME', 'NONE')).toEqual({
      status: 'COMPLETED',
      attendance: 'NONE',
    });
  });

  it('flags settled lessons not attended by both until someone reviews them', () => {
    expect(
      needsReview({
        status: 'COMPLETED',
        attendance: 'TEACHER_ONLY',
        closedAt: t,
        reviewedAt: null,
      }),
    ).toBe(true);
    expect(
      needsReview({
        status: 'COMPLETED',
        attendance: 'TEACHER_ONLY',
        closedAt: t,
        reviewedAt: t,
      }),
    ).toBe(false);
    expect(
      needsReview({
        status: 'COMPLETED',
        attendance: 'BOTH',
        closedAt: t,
        reviewedAt: null,
      }),
    ).toBe(false);
    expect(
      needsReview({
        status: 'CANCELLED',
        attendance: 'NONE',
        closedAt: t,
        reviewedAt: null,
      }),
    ).toBe(false);
  });
});

describe('teacher cancellations', () => {
  it('allows four a month, then needs an admin', () => {
    expect(TEACHER_CANCELS_PER_MONTH).toBe(4);
    expect(teacherCancelCheck(3, 'October 2026')).toEqual([]);
    expect(teacherCancelCheck(4, 'October 2026')).toEqual([
      {
        code: 'TEACHER_CANCEL_LIMIT',
        message: 'All 4 teacher cancellations for October 2026 are used.',
      },
    ]);
  });
});
