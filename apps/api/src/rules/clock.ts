/**
 * Clock changes. Lessons stay put on the student's clock, so when Egypt and
 * the student's country change their clocks on different days, the lesson
 * moves on the teacher's (Cairo) clock. These functions find the changes
 * and the lessons that end up outside the teacher's hours or on top of
 * another lesson because of it (or for any other reason).
 */
import { DateTime } from 'luxon';
import {
  ACADEMY_TZ,
  type Busy,
  fitsAvailability,
  overlaps,
  type Window,
} from './schedule.js';

export interface ClockChange {
  timezone: string;
  /** the first instant on the new offset */
  at: Date;
  /** minutes from UTC, e.g. 180 for UTC+3 */
  offsetBefore: number;
  offsetAfter: number;
}

const HOUR = 3_600_000;
const MINUTE = 60_000;

export function offsetAt(timezone: string, instant: Date): number {
  return DateTime.fromJSDate(instant, { zone: timezone }).offset;
}

/** Every offset change in these zones between two instants, in time order. */
export function clockChanges(
  timezones: string[],
  from: Date,
  to: Date,
): ClockChange[] {
  const out: ClockChange[] = [];
  for (const timezone of new Set(timezones)) {
    // Changes happen on whole minutes; stepping from one keeps the search exact.
    let prevTime = Math.floor(from.getTime() / MINUTE) * MINUTE;
    let prevOffset = offsetAt(timezone, new Date(prevTime));
    for (let t = prevTime + HOUR; t <= to.getTime() + HOUR; t += HOUR) {
      const offset = offsetAt(timezone, new Date(t));
      if (offset !== prevOffset) {
        // Narrow down to the minute.
        let lo = prevTime;
        let hi = t;
        while (hi - lo > MINUTE) {
          const mid = lo + Math.floor((hi - lo) / 2 / MINUTE) * MINUTE;
          if (offsetAt(timezone, new Date(mid)) === prevOffset) lo = mid;
          else hi = mid;
        }
        if (hi <= to.getTime() && hi >= from.getTime()) {
          out.push({
            timezone,
            at: new Date(hi),
            offsetBefore: prevOffset,
            offsetAfter: offset,
          });
        }
        prevOffset = offset;
      }
      prevTime = t;
    }
  }
  return out.sort(
    (a, b) =>
      a.at.getTime() - b.at.getTime() || a.timezone.localeCompare(b.timezone),
  );
}

/**
 * Minutes this lesson sits later (+) or earlier (-) on the teacher's clock
 * than the same student-clock time would at `reference` (usually now).
 * 0 when no clock change falls in between, or both sides changed together.
 */
export function teacherClockShift(
  startsAt: Date,
  studentTz: string,
  reference: Date,
  teacherTz = ACADEMY_TZ,
): number {
  const gap = (d: Date) => offsetAt(teacherTz, d) - offsetAt(studentTz, d);
  return gap(startsAt) - gap(reference);
}

export interface PlannedLesson extends Busy {
  id: string;
  teacherId: string;
  studentId: string;
}

export type ScheduleProblemKind =
  'OUTSIDE_HOURS' | 'TEACHER_CLASH' | 'STUDENT_CLASH';

export interface ScheduleProblem {
  lessonId: string;
  kind: ScheduleProblemKind;
  /** the other lesson, for a clash */
  withLessonId?: string;
}

/**
 * Upcoming lessons that cannot go ahead as booked: outside the teacher's
 * weekly hours (Cairo clock), or overlapping another lesson of the same
 * teacher or the same student. A clash is reported once, on the later lesson.
 */
export function scheduleProblems(
  lessons: PlannedLesson[],
  windowsByTeacher: Map<string, Window[]>,
  teacherTz = ACADEMY_TZ,
): ScheduleProblem[] {
  const problems: ScheduleProblem[] = [];
  for (const l of lessons) {
    const windows = windowsByTeacher.get(l.teacherId) ?? [];
    if (!fitsAvailability(windows, l.startsAt, l.durationMin, teacherTz))
      problems.push({ lessonId: l.id, kind: 'OUTSIDE_HOURS' });
  }
  const clashes = (
    key: 'teacherId' | 'studentId',
    kind: ScheduleProblemKind,
  ) => {
    const groups = new Map<string, PlannedLesson[]>();
    for (const l of lessons)
      groups.set(l[key], [...(groups.get(l[key]) ?? []), l]);
    for (const group of groups.values()) {
      group.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          // Sorted by start: once one starts after i ends, the rest do too.
          if (
            group[j].startsAt.getTime() >=
            group[i].startsAt.getTime() + group[i].durationMin * MINUTE
          )
            break;
          if (overlaps(group[i], group[j]))
            problems.push({
              lessonId: group[j].id,
              kind,
              withLessonId: group[i].id,
            });
        }
      }
    }
  };
  clashes('teacherId', 'TEACHER_CLASH');
  clashes('studentId', 'STUDENT_CLASH');
  return problems;
}
