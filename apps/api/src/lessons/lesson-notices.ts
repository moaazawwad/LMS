import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { AuthUser } from '../common/auth-user.js';
import type { Tx } from '../db/db.module.js';
import {
  lessons,
  students,
  subscriptions,
  teachers,
  users,
} from '../db/schema.js';
import { appUrl, MailService } from '../mail/mail.service.js';
import { lessonChangeEmail } from '../mail/templates.js';
import { ACADEMY_TZ, formatInZone } from '../rules/schedule.js';

const city = (tz: string) => tz.split('/').pop()!.replace(/_/g, ' ');
const at = (d: Date, tz: string) =>
  `${formatInZone(d, tz, 'ccc, LLL d · h:mm a')} (${tz === ACADEMY_TZ ? 'Cairo' : city(tz)} time)`;

export type LessonChange =
  | { kind: 'cancelled'; note?: string }
  | { kind: 'moved'; to: Date }
  | {
      kind: 'declined';
      requestKind: 'CANCEL' | 'RESCHEDULE';
      reply: string;
      requesterUserId: string;
    };

/**
 * Emails the people a lesson change concerns, on their own clock: the student
 * and the teacher, except whoever made the change. Past lessons are skipped
 * (settling attendance is not news to anyone).
 */
@Injectable()
export class LessonNotices {
  constructor(private readonly mail: MailService) {}

  async send(
    tx: Tx,
    actor: AuthUser | null,
    lessonId: string,
    change: LessonChange,
    now = new Date(),
  ) {
    const studentUser = alias(users, 'n_student_user');
    const teacherUser = alias(users, 'n_teacher_user');
    const [l] = await tx
      .select({
        startsAt: lessons.startsAt,
        student: {
          id: studentUser.id,
          name: studentUser.fullName,
          email: studentUser.email,
          tz: studentUser.timezone,
        },
        teacher: {
          id: teacherUser.id,
          name: teacherUser.fullName,
          email: teacherUser.email,
        },
        subTz: subscriptions.timezone,
      })
      .from(lessons)
      .innerJoin(students, eq(students.id, lessons.studentId))
      .innerJoin(studentUser, eq(studentUser.id, students.userId))
      .innerJoin(teachers, eq(teachers.id, lessons.teacherId))
      .innerJoin(teacherUser, eq(teacherUser.id, teachers.userId))
      .leftJoin(subscriptions, eq(subscriptions.id, lessons.subscriptionId))
      .where(eq(lessons.id, lessonId));
    if (!l || l.startsAt.getTime() <= now.getTime()) return;
    const studentTz = l.subTz ?? l.student.tz;
    const people = [
      {
        userId: l.student.id,
        name: l.student.name,
        email: l.student.email,
        tz: studentTz,
        other: l.teacher.name,
        link: `${appUrl()}/student/home`,
      },
      {
        userId: l.teacher.id,
        name: l.teacher.name,
        email: l.teacher.email,
        tz: ACADEMY_TZ,
        other: l.student.name,
        link: `${appUrl()}/teacher/today`,
      },
    ];
    for (const p of people) {
      if (
        change.kind === 'declined'
          ? p.userId !== change.requesterUserId
          : p.userId === actor?.userId
      )
        continue;
      const when = at(l.startsAt, p.tz);
      let content;
      if (change.kind === 'cancelled') {
        content = lessonChangeEmail({
          name: p.name,
          title: 'Lesson cancelled',
          lines: [
            `Your lesson with ${p.other} on ${when} is cancelled.`,
            ...(change.note && actor && actor.role !== 'STUDENT'
              ? [`Note from the academy: ${change.note}`]
              : []),
          ],
          link: p.link,
        });
      } else if (change.kind === 'moved') {
        content = lessonChangeEmail({
          name: p.name,
          title: 'Lesson moved',
          lines: [
            `Your lesson with ${p.other} on ${when} moved to ${at(change.to, p.tz)}.`,
          ],
          link: p.link,
        });
      } else {
        content = lessonChangeEmail({
          name: p.name,
          title: 'Your request was declined',
          lines: [
            `The academy declined your request to ${change.requestKind === 'CANCEL' ? 'cancel' : 'move'} the lesson with ${p.other} on ${when}. The lesson stays as it is.`,
            `Their reply: ${change.reply}`,
          ],
          link: p.link,
        });
      }
      await this.mail.enqueue(tx, p.email, `lesson-${change.kind}`, content);
    }
    this.mail.sendSoon();
  }
}
