import { Injectable } from '@nestjs/common';
import { and, eq, gt, inArray, lt, ne, or, type SQL } from 'drizzle-orm';
import type { Executor } from '../db/db.module.js';
import {
  availabilityWindows,
  lessons,
  subscriptions,
  teacherCurricula,
  weeklySlots,
} from '../db/schema.js';
import type { RuleViolation } from '../rules/lesson-rules.js';
import { DateTime } from 'luxon';
import { CYCLE_DAYS } from '../rules/billing.js';
import {
  type Busy,
  ACADEMY_TZ,
  fitsAvailability,
  hoursOnDay,
  occurrencesInRange,
  overlaps,
  weeklyFreeTimes,
  type Window,
} from '../rules/schedule.js';

const SEARCH_MARGIN_MS = 12 * 3_600_000;

/** Shared checks used whenever a lesson is created or moved. */
/** "...; their hours are Thu 12:00 PM–12:00 AM Cairo." or "...; they have no hours on Thu." */
function unavailableText(windows: Window[], startsAt: Date): string {
  const hours = hoursOnDay(windows, startsAt);
  const day = DateTime.fromJSDate(startsAt, { zone: ACADEMY_TZ }).toFormat(
    'ccc',
  );
  return hours
    ? `The teacher is not available at that time; their hours are ${hours} Cairo.`
    : `The teacher is not available at that time; they have no hours on ${day} (Cairo).`;
}

@Injectable()
export class SchedulingService {
  async teacherWindows(exec: Executor, teacherId: string): Promise<Window[]> {
    return exec
      .select({
        weekday: availabilityWindows.weekday,
        startMinute: availabilityWindows.startMinute,
        endMinute: availabilityWindows.endMinute,
      })
      .from(availabilityWindows)
      .where(eq(availabilityWindows.teacherId, teacherId));
  }

  async teachesCurriculum(
    exec: Executor,
    teacherId: string,
    curriculumId: string,
  ): Promise<boolean> {
    const [row] = await exec
      .select({ t: teacherCurricula.teacherId })
      .from(teacherCurricula)
      .where(
        and(
          eq(teacherCurricula.teacherId, teacherId),
          eq(teacherCurricula.curriculumId, curriculumId),
        ),
      );
    return !!row;
  }

  /** Lessons (scheduled or done) of these people near a time, for clash checks and free-slot lists. */
  async busyNear(
    exec: Executor,
    who: { teacherId?: string; studentId?: string },
    from: Date,
    to: Date,
    excludeLessonId?: string,
  ) {
    const people: SQL[] = [];
    if (who.teacherId) people.push(eq(lessons.teacherId, who.teacherId));
    if (who.studentId) people.push(eq(lessons.studentId, who.studentId));
    const where: (SQL | undefined)[] = [
      or(...people),
      inArray(lessons.status, ['SCHEDULED', 'COMPLETED']),
      gt(lessons.startsAt, new Date(from.getTime() - SEARCH_MARGIN_MS)),
      lt(lessons.startsAt, new Date(to.getTime() + SEARCH_MARGIN_MS)),
    ];
    if (excludeLessonId) where.push(ne(lessons.id, excludeLessonId));
    return exec
      .select({
        id: lessons.id,
        teacherId: lessons.teacherId,
        studentId: lessons.studentId,
        subscriptionId: lessons.subscriptionId,
        startsAt: lessons.startsAt,
        durationMin: lessons.durationMin,
      })
      .from(lessons)
      .where(and(...where));
  }

  /** Everything that would make a lesson at this time a problem. */
  async checkSlot(
    exec: Executor,
    input: {
      teacherId: string;
      studentId: string;
      startsAt: Date;
      durationMin: number;
      excludeLessonId?: string;
      windows?: Window[];
    },
  ): Promise<RuleViolation[]> {
    const violations: RuleViolation[] = [];
    const windows =
      input.windows ?? (await this.teacherWindows(exec, input.teacherId));
    if (!fitsAvailability(windows, input.startsAt, input.durationMin)) {
      // Say what the teacher's hours are that day, so it is clear why.
      violations.push({
        code: 'TEACHER_UNAVAILABLE',
        message: unavailableText(windows, input.startsAt),
      });
    }
    const candidate = {
      startsAt: input.startsAt,
      durationMin: input.durationMin,
    };
    const busy = await this.busyNear(
      exec,
      { teacherId: input.teacherId, studentId: input.studentId },
      input.startsAt,
      input.startsAt,
      input.excludeLessonId,
    );
    const clashes = busy.filter((b) => overlaps(candidate, b));
    if (clashes.some((b) => b.teacherId === input.teacherId)) {
      violations.push({
        code: 'TIME_CONFLICT',
        message: 'The teacher already has a lesson at that time.',
      });
    }
    if (clashes.some((b) => b.studentId === input.studentId)) {
      violations.push({
        code: 'TIME_CONFLICT',
        message: 'The student already has a lesson at that time.',
      });
    }
    return violations;
  }

  /**
   * A teacher's free weekly times for a new recurring booking, on the
   * student's clock, checked across the whole first cycle: the teacher's
   * hours, lessons already booked, and other students' recurring slots
   * (their next cycles may not have lessons yet).
   */
  async weeklyFree(
    exec: Executor,
    input: {
      teacherId: string;
      timezone: string;
      startDate: string;
      durationMin: number;
      stepMin: number;
      excludeSubscriptionId?: string;
    },
  ) {
    const fromDate = input.startDate;
    const toDate = DateTime.fromISO(fromDate)
      .plus({ days: CYCLE_DAYS - 1 })
      .toISODate()!;
    const from = DateTime.fromISO(fromDate, { zone: input.timezone })
      .startOf('day')
      .toJSDate();
    const to = DateTime.fromISO(toDate, { zone: input.timezone })
      .endOf('day')
      .toJSDate();

    const windows = await this.teacherWindows(exec, input.teacherId);
    const booked = (
      await this.busyNear(exec, { teacherId: input.teacherId }, from, to)
    ).filter(
      (b) =>
        !input.excludeSubscriptionId ||
        b.subscriptionId !== input.excludeSubscriptionId,
    );

    const recurring = await exec
      .select({
        subscriptionId: subscriptions.id,
        timezone: subscriptions.timezone,
        weekday: weeklySlots.weekday,
        startTime: weeklySlots.startTime,
      })
      .from(weeklySlots)
      .innerJoin(
        subscriptions,
        eq(subscriptions.id, weeklySlots.subscriptionId),
      )
      .where(
        and(
          eq(subscriptions.teacherId, input.teacherId),
          eq(subscriptions.status, 'ACTIVE'),
        ),
      );
    const busy: Busy[] = [...booked];
    for (const r of recurring) {
      if (r.subscriptionId === input.excludeSubscriptionId) continue;
      for (const startsAt of occurrencesInRange({
        timezone: r.timezone,
        slots: [r],
        fromDate,
        toDate,
      })) {
        busy.push({ startsAt, durationMin: input.durationMin });
      }
    }

    return {
      timezone: input.timezone,
      fromDate,
      toDate,
      days: weeklyFreeTimes({
        timezone: input.timezone,
        fromDate,
        toDate,
        durationMin: input.durationMin,
        stepMin: input.stepMin,
        windows,
        busy,
      }),
    };
  }
}
