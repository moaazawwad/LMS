import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, lt } from 'drizzle-orm';
import type { AuthUser } from '../common/auth-user.js';
import { DB, type Db } from '../db/db.module.js';
import {
  availabilityWindows,
  lessons,
  students,
  subscriptions,
  users,
} from '../db/schema.js';
import {
  clockChanges,
  type ScheduleProblemKind,
  scheduleProblems,
  teacherClockShift,
} from '../rules/clock.js';
import { ACADEMY_TZ, type Window } from '../rules/schedule.js';
import { LessonsService } from './lessons.service.js';

const DAY = 86_400_000;
/** How far ahead clock changes are announced. */
export const CLOCK_CHANGE_LOOKAHEAD_DAYS = 60;

/**
 * Looks ahead for lessons that cannot go ahead as booked: outside the
 * teacher's hours or on top of another lesson. Clock changes are the usual
 * cause (the lesson stays on the student's clock and moves on Cairo's), so
 * the answer also lists the coming changes and how far each lesson moved.
 */
@Injectable()
export class ScheduleCheckService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly lessons: LessonsService,
  ) {}

  async check(user: AuthUser, days = 42, now = new Date()) {
    const to = new Date(now.getTime() + days * DAY);
    const rows = await this.db
      .select({
        id: lessons.id,
        teacherId: lessons.teacherId,
        studentId: lessons.studentId,
        startsAt: lessons.startsAt,
        durationMin: lessons.durationMin,
        subTz: subscriptions.timezone,
        studentTz: users.timezone,
      })
      .from(lessons)
      .innerJoin(students, eq(students.id, lessons.studentId))
      .innerJoin(users, eq(users.id, students.userId))
      .leftJoin(subscriptions, eq(subscriptions.id, lessons.subscriptionId))
      .where(
        and(
          eq(lessons.status, 'SCHEDULED'),
          gte(lessons.startsAt, now),
          lt(lessons.startsAt, to),
        ),
      );

    const teacherIds = [...new Set(rows.map((r) => r.teacherId))];
    const windows = new Map<string, Window[]>();
    if (teacherIds.length) {
      const all = await this.db
        .select()
        .from(availabilityWindows)
        .where(inArray(availabilityWindows.teacherId, teacherIds));
      for (const w of all)
        windows.set(w.teacherId, [...(windows.get(w.teacherId) ?? []), w]);
    }

    const zoneOf = new Map(rows.map((r) => [r.id, r.subTz ?? r.studentTz]));
    const shift = (r: { id: string; startsAt: Date }) =>
      teacherClockShift(r.startsAt, zoneOf.get(r.id)!, now);
    const problems = scheduleProblems(rows, windows);

    // Zones the academy works with right now: Cairo and every active student's.
    const active = await this.db
      .select({
        timezone: subscriptions.timezone,
        studentId: subscriptions.studentId,
      })
      .from(subscriptions)
      .where(eq(subscriptions.status, 'ACTIVE'));
    const studentsByZone = new Map<string, Set<string>>();
    for (const a of active)
      studentsByZone.set(
        a.timezone,
        (studentsByZone.get(a.timezone) ?? new Set()).add(a.studentId),
      );
    const changes = clockChanges(
      [ACADEMY_TZ, ...studentsByZone.keys()],
      now,
      new Date(now.getTime() + CLOCK_CHANGE_LOOKAHEAD_DAYS * DAY),
    );

    const ids = [
      ...new Set(
        problems.flatMap((p) =>
          p.withLessonId ? [p.lessonId, p.withLessonId] : [p.lessonId],
        ),
      ),
    ];
    const views = new Map(
      (await this.lessons.viewsByIds(user, ids, now)).map((v) => [v.id, v]),
    );
    const byId = new Map(rows.map((r) => [r.id, r]));

    return {
      from: now,
      to,
      clockChanges: changes.map((c) => ({
        ...c,
        /** active students on that clock; null for Cairo (every teacher) */
        students:
          c.timezone === ACADEMY_TZ
            ? null
            : (studentsByZone.get(c.timezone)?.size ?? 0),
      })),
      /** upcoming lessons at a different Cairo time than today, because of a clock change */
      movedLessons: rows.filter((r) => shift(r) !== 0).length,
      problems: problems
        .map((p) => ({
          kind: p.kind as ScheduleProblemKind,
          lesson: views.get(p.lessonId)!,
          with: p.withLessonId ? views.get(p.withLessonId)! : null,
          /** minutes it moved on the Cairo clock since today; not 0 = a clock change is behind it */
          clockShiftMin: shift(byId.get(p.lessonId)!),
        }))
        .sort(
          (a, b) => a.lesson.startsAt.getTime() - b.lesson.startsAt.getTime(),
        ),
    };
  }
}
