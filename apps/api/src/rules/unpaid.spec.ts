import {
  countsAsTaken,
  invoiceFor,
  UNPAID_GRACE_LESSONS,
  unpaidStep,
} from './billing.js';

const at = (iso: string) => new Date(iso);

describe('unpaid invoices: two lessons, then the lessons stop', () => {
  const open = { status: 'OPEN' as const, totalCents: 8000, cycleEnded: false };

  it('gives two lessons of grace', () => {
    expect(UNPAID_GRACE_LESSONS).toBe(2);
    expect(unpaidStep({ ...open, lessonsTaken: 0 })).toEqual({
      step: 'GRACE',
      taken: 0,
      left: 2,
    });
    expect(unpaidStep({ ...open, lessonsTaken: 1 })).toEqual({
      step: 'GRACE',
      taken: 1,
      left: 1,
    });
  });

  it('stops the lessons once two were taken', () => {
    expect(unpaidStep({ ...open, lessonsTaken: 2 })).toEqual({
      step: 'HOLD',
      why: 'GRACE_USED',
    });
    expect(unpaidStep({ ...open, lessonsTaken: 5 }).step).toBe('HOLD');
  });

  it('stops a cycle that ended unpaid, even with fewer lessons taken', () => {
    expect(unpaidStep({ ...open, lessonsTaken: 1, cycleEnded: true })).toEqual({
      step: 'HOLD',
      why: 'CYCLE_ENDED',
    });
  });

  it('leaves paid, void and zero invoices alone', () => {
    for (const status of ['PAID', 'VOID'] as const)
      expect(
        unpaidStep({ ...open, status, lessonsTaken: 9, cycleEnded: true }),
      ).toEqual({ step: 'NOTHING' });
    expect(
      unpaidStep({ ...open, totalCents: 0, lessonsTaken: 9, cycleEnded: true }),
    ).toEqual({ step: 'NOTHING' });
  });
});

describe('which lessons of an unpaid cycle count as taken', () => {
  const now = at('2026-11-10T12:00:00Z');
  const base = {
    startsAt: at('2026-11-10T10:00:00Z'),
    durationMin: 60,
    countedAsTaken: false,
    extraReason: null,
  };

  it('counts a held lesson and one that ended without a decision', () => {
    expect(countsAsTaken({ ...base, status: 'COMPLETED' }, now)).toBe(true);
    expect(countsAsTaken({ ...base, status: 'SCHEDULED' }, now)).toBe(true);
  });

  it('does not count a lesson still running or still ahead', () => {
    const running = { ...base, startsAt: at('2026-11-10T11:30:00Z') };
    expect(countsAsTaken({ ...running, status: 'SCHEDULED' }, now)).toBe(false);
    const ahead = { ...base, startsAt: at('2026-11-12T10:00:00Z') };
    expect(countsAsTaken({ ...ahead, status: 'SCHEDULED' }, now)).toBe(false);
  });

  it('counts a late cancel, not a cancel with credit or a moved lesson', () => {
    expect(
      countsAsTaken(
        { ...base, status: 'CANCELLED', countedAsTaken: true },
        now,
      ),
    ).toBe(true);
    expect(countsAsTaken({ ...base, status: 'CANCELLED' }, now)).toBe(false);
    expect(countsAsTaken({ ...base, status: 'RESCHEDULED' }, now)).toBe(false);
  });

  it('never counts a makeup', () => {
    expect(
      countsAsTaken(
        { ...base, status: 'COMPLETED', extraReason: 'MAKEUP' },
        now,
      ),
    ).toBe(false);
  });
});

describe('an invoice for the lessons taken only', () => {
  it('bills the count given instead of the full cycle', () => {
    expect(
      invoiceFor({
        lessonsPerWeek: 2,
        priceCents: 1000,
        pendingCredits: 0,
        lessonsCount: 2,
      }),
    ).toMatchObject({ lessonsCount: 2, billedLessons: 2, totalCents: 2000 });
  });

  it('still takes credits off and adds extra lessons', () => {
    expect(
      invoiceFor({
        lessonsPerWeek: 2,
        priceCents: 1000,
        pendingCredits: 1,
        extraLessons: 1,
        lessonsCount: 2,
      }),
    ).toMatchObject({ creditsApplied: 1, billedLessons: 2, totalCents: 2000 });
  });

  it('never goes below zero', () => {
    expect(
      invoiceFor({
        lessonsPerWeek: 2,
        priceCents: 1000,
        pendingCredits: 5,
        lessonsCount: 0,
      }),
    ).toMatchObject({ lessonsCount: 0, billedLessons: 0, totalCents: 0 });
  });
});
