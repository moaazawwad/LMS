import { clockChanges, scheduleProblems, teacherClockShift } from './clock.js';

const at = (iso: string) => new Date(iso);

describe('clock changes', () => {
  it('finds the autumn 2026 changes to the minute', () => {
    const changes = clockChanges(
      ['Africa/Cairo', 'America/New_York', 'Europe/London', 'Australia/Sydney'],
      at('2026-10-21T00:00:00Z'),
      at('2026-12-01T00:00:00Z'),
    );
    expect(
      changes.map((c) => [
        c.timezone,
        c.at.toISOString(),
        c.offsetBefore,
        c.offsetAfter,
      ]),
    ).toEqual([
      ['Europe/London', '2026-10-25T01:00:00.000Z', 60, 0],
      // Egypt: midnight between Thursday and Friday.
      ['Africa/Cairo', '2026-10-29T21:00:00.000Z', 180, 120],
      ['America/New_York', '2026-11-01T06:00:00.000Z', -240, -300],
    ]);
  });

  it('is exact even when the search starts mid-minute', () => {
    const [cairo] = clockChanges(
      ['Africa/Cairo'],
      at('2026-10-21T08:17:42.123Z'),
      at('2026-11-30T00:00:00Z'),
    );
    expect(cairo.at.toISOString()).toBe('2026-10-29T21:00:00.000Z');
  });

  it('finds nothing in a quiet stretch, and lists a zone once', () => {
    expect(
      clockChanges(
        ['Africa/Cairo', 'Africa/Cairo'],
        at('2026-12-01T00:00:00Z'),
        at('2027-01-31T00:00:00Z'),
      ),
    ).toEqual([]);
  });

  it('works out how far a lesson moves on the Cairo clock', () => {
    const now = at('2026-10-21T10:00:00Z');
    // New York 9:00 AM on Fri Oct 30: Egypt already changed, New York not yet. One hour earlier in Cairo.
    expect(
      teacherClockShift(at('2026-10-30T13:00:00Z'), 'America/New_York', now),
    ).toBe(-60);
    // After New York changes too, it is back where it was.
    expect(
      teacherClockShift(at('2026-11-03T14:00:00Z'), 'America/New_York', now),
    ).toBe(0);
    // London changes first: Oct 25 to 29 the lesson is an hour later in Cairo.
    expect(
      teacherClockShift(at('2026-10-28T16:00:00Z'), 'Europe/London', now),
    ).toBe(60);
    // Sydney stays on summer time: from Egypt's change on, an hour earlier for months.
    expect(
      teacherClockShift(at('2026-11-09T07:00:00Z'), 'Australia/Sydney', now),
    ).toBe(-60);
    // A Cairo student never moves.
    expect(
      teacherClockShift(at('2026-11-09T07:00:00Z'), 'Africa/Cairo', now),
    ).toBe(0);
  });
});

describe('schedule problems', () => {
  // Every day 9:00 AM to 11:00 PM Cairo.
  const windows = new Map([
    [
      't1',
      [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
        weekday,
        startMinute: 9 * 60,
        endMinute: 23 * 60,
      })),
    ],
  ]);
  const lesson = (
    id: string,
    iso: string,
    extra: Partial<{
      teacherId: string;
      studentId: string;
      durationMin: number;
    }> = {},
  ) => ({
    id,
    teacherId: 't1',
    studentId: `s-${id}`,
    startsAt: at(iso),
    durationMin: 60,
    ...extra,
  });

  it('flags a lesson pushed out of the teacher hours', () => {
    // Sydney 6:00 PM after Egypt's change = 8:00 AM Cairo, before the teacher starts.
    expect(
      scheduleProblems([lesson('a', '2026-11-09T06:00:00Z')], windows),
    ).toEqual([{ lessonId: 'a', kind: 'OUTSIDE_HOURS' }]);
    expect(
      scheduleProblems([lesson('a', '2026-11-09T08:00:00Z')], windows),
    ).toEqual([]);
  });

  it('flags two lessons of one teacher on top of each other, once', () => {
    const problems = scheduleProblems(
      [
        lesson('a', '2026-11-09T13:00:00Z'),
        lesson('b', '2026-11-09T13:30:00Z'),
        lesson('c', '2026-11-09T14:00:00Z'),
      ],
      windows,
    );
    expect(problems).toEqual([
      { lessonId: 'b', kind: 'TEACHER_CLASH', withLessonId: 'a' },
      { lessonId: 'c', kind: 'TEACHER_CLASH', withLessonId: 'b' },
    ]);
  });

  it('flags a student booked twice at once, even with two teachers', () => {
    const both = new Map([...windows, ['t2', windows.get('t1')!]]);
    const problems = scheduleProblems(
      [
        lesson('a', '2026-11-09T13:00:00Z', { studentId: 's1' }),
        lesson('b', '2026-11-09T13:00:00Z', {
          studentId: 's1',
          teacherId: 't2',
        }),
      ],
      both,
    );
    expect(problems).toEqual([
      { lessonId: 'b', kind: 'STUDENT_CLASH', withLessonId: 'a' },
    ]);
  });

  it('lets back-to-back lessons be', () => {
    expect(
      scheduleProblems(
        [
          lesson('a', '2026-11-09T13:00:00Z'),
          lesson('b', '2026-11-09T14:00:00Z'),
        ],
        windows,
      ),
    ).toEqual([]);
  });
});
