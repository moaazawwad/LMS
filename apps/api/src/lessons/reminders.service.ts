import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, asc, eq, gt, isNull, lte } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DB, type Db } from '../db/db.module.js';
import {
  lessons,
  students,
  subscriptions,
  teachers,
  users,
} from '../db/schema.js';
import { appUrl, MailService } from '../mail/mail.service.js';
import { lessonReminderEmail } from '../mail/templates.js';
import { ACADEMY_TZ, formatInZone } from '../rules/schedule.js';

/** Remind about lessons starting within this many minutes... */
export const REMIND_BEFORE_MIN = 60;
/** ...but not when they start sooner than this (the reminder would come too late). */
const TOO_LATE_MIN = 10;

const city = (tz: string) => tz.split('/').pop()!.replace(/_/g, ' ');

/**
 * An email to the student and the teacher about an hour before each lesson,
 * each on their own clock. Each lesson is reminded once.
 */
@Injectable()
export class RemindersService {
  private readonly log = new Logger('Reminders');

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly mail: MailService,
  ) {}

  @Cron('*/5 * * * *')
  async sendDue(now: Date = new Date()): Promise<number> {
    const studentUser = alias(users, 'student_user');
    const teacherUser = alias(users, 'teacher_user');
    const due = await this.db
      .select({
        id: lessons.id,
        startsAt: lessons.startsAt,
        studentName: studentUser.fullName,
        studentEmail: studentUser.email,
        studentTz: studentUser.timezone,
        subTz: subscriptions.timezone,
        teacherName: teacherUser.fullName,
        teacherEmail: teacherUser.email,
      })
      .from(lessons)
      .innerJoin(students, eq(students.id, lessons.studentId))
      .innerJoin(studentUser, eq(studentUser.id, students.userId))
      .innerJoin(teachers, eq(teachers.id, lessons.teacherId))
      .innerJoin(teacherUser, eq(teacherUser.id, teachers.userId))
      .leftJoin(subscriptions, eq(subscriptions.id, lessons.subscriptionId))
      .where(
        and(
          eq(lessons.status, 'SCHEDULED'),
          isNull(lessons.reminderSentAt),
          gt(lessons.startsAt, new Date(now.getTime() + TOO_LATE_MIN * 60_000)),
          lte(
            lessons.startsAt,
            new Date(now.getTime() + REMIND_BEFORE_MIN * 60_000),
          ),
        ),
      )
      .orderBy(asc(lessons.startsAt))
      .limit(200);

    let reminded = 0;
    for (const l of due) {
      const minutes = Math.max(
        5,
        Math.round((l.startsAt.getTime() - now.getTime()) / 300_000) * 5,
      );
      const tz = l.subTz ?? l.studentTz;
      await this.db.transaction(async (tx) => {
        // Claim it, so two runs never remind twice.
        const claimed = await tx
          .update(lessons)
          .set({ reminderSentAt: now })
          .where(and(eq(lessons.id, l.id), isNull(lessons.reminderSentAt)))
          .returning({ id: lessons.id });
        if (!claimed.length) return;
        await this.mail.enqueue(
          tx,
          l.studentEmail,
          'lesson-reminder',
          lessonReminderEmail({
            name: l.studentName,
            withName: l.teacherName,
            when: formatInZone(l.startsAt, tz, 'h:mm a'),
            zoneNote: `${city(tz)} time`,
            link: `${appUrl()}/student/home`,
            minutes,
          }),
        );
        await this.mail.enqueue(
          tx,
          l.teacherEmail,
          'lesson-reminder',
          lessonReminderEmail({
            name: l.teacherName,
            withName: l.studentName,
            when: formatInZone(l.startsAt, ACADEMY_TZ, 'h:mm a'),
            zoneNote: 'Cairo time',
            link: `${appUrl()}/teacher/today`,
            minutes,
          }),
        );
        reminded++;
      });
    }
    if (reminded) {
      this.log.log(`Reminders queued for ${reminded} lesson(s)`);
      this.mail.sendSoon();
    }
    return reminded;
  }
}
