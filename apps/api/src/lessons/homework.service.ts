import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, count, eq, isNotNull, isNull } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { type AuthUser, canUse } from '../common/auth-user.js';
import { DB, type Db, type Tx } from '../db/db.module.js';
import {
  homeworkFiles,
  lessons,
  students,
  teachers,
  users,
} from '../db/schema.js';
import { appUrl, MailService } from '../mail/mail.service.js';
import { noticeEmail } from '../mail/templates.js';
import { formatInZone } from '../rules/schedule.js';
import { LessonsService } from './lessons.service.js';

/** What a student can attach: photos, PDFs and voice recordings. */
export const HOMEWORK_FILE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
  'audio/mpeg',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
  'audio/webm',
  'audio/ogg',
  'audio/wav',
  'audio/x-wav',
];
export const HOMEWORK_FILE_MAX_BYTES = 8 * 1024 * 1024;
export const HOMEWORK_FILES_PER_LESSON = 3;

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const fileColumns = {
  id: homeworkFiles.id,
  fileName: homeworkFiles.fileName,
  contentType: homeworkFiles.contentType,
  size: homeworkFiles.size,
  createdAt: homeworkFiles.createdAt,
};

const short = (s: string, n = 60) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;

/**
 * Homework the teacher sets on a lesson: the student sends an answer (and
 * may change it until it is checked); the teacher, or the academy, writes
 * feedback. Each side gets an email.
 */
@Injectable()
export class HomeworkService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly lessons: LessonsService,
  ) {}

  async send(user: AuthUser, id: string, answer: string, now = new Date()) {
    if (user.role !== 'STUDENT')
      throw new ForbiddenException('The student sends the homework.');
    const text = answer.trim();
    if (!text) throw new BadRequestException('Write your answer first.');
    await this.db.transaction(async (tx) => {
      const [l] = await tx
        .select()
        .from(lessons)
        .where(eq(lessons.id, id))
        .for('update');
      if (!l || l.studentId !== user.studentId)
        throw new NotFoundException('Lesson not found.');
      if (!l.homeworkTitle && !l.homeworkBody)
        throw new ConflictException('This lesson has no homework.');
      if (l.homeworkCheckedAt)
        throw new ConflictException(
          'Your teacher already checked this homework.',
        );
      await tx
        .update(lessons)
        .set({ homeworkAnswer: text, homeworkSentAt: now })
        .where(eq(lessons.id, id));
      const title = l.homeworkTitle || 'Homework';
      await this.audit.record(tx, user, {
        action: 'homework.send',
        entityType: 'lesson',
        entityId: id,
        summary: `${l.homeworkSentAt ? 'Changed the answer to' : 'Sent'} homework "${short(title)}"`,
      });
      const teacher = await this.person(tx, 'teacher', l.teacherId);
      await this.mail.enqueue(
        tx,
        teacher.email,
        'homework-sent',
        noticeEmail({
          name: teacher.name,
          title: `${user.fullName} sent their homework`,
          lines: [
            `${user.fullName} sent the homework "${title}" from the lesson on ${formatInZone(l.startsAt, teacher.timezone)} (Cairo time).`,
          ],
          button: 'Read it and reply',
          link: `${appUrl()}/teacher/lessons/${id}`,
        }),
      );
    });
    return this.lessons.get(user, id, now);
  }

  async check(user: AuthUser, id: string, feedback: string, now = new Date()) {
    if (user.role === 'STUDENT') throw new ForbiddenException();
    if (!canUse(user, 'lessons')) throw new ForbiddenException();
    const text = feedback.trim();
    if (!text)
      throw new BadRequestException('Write a short note for the student.');
    await this.db.transaction(async (tx) => {
      const [l] = await tx
        .select()
        .from(lessons)
        .where(eq(lessons.id, id))
        .for('update');
      if (!l || (user.role === 'TEACHER' && l.teacherId !== user.teacherId))
        throw new NotFoundException('Lesson not found.');
      if (!l.homeworkSentAt)
        throw new ConflictException(
          'The student has not sent this homework yet.',
        );
      await tx
        .update(lessons)
        .set({ homeworkFeedback: text, homeworkCheckedAt: now })
        .where(eq(lessons.id, id));
      const title = l.homeworkTitle || 'Homework';
      await this.audit.record(tx, user, {
        action: 'homework.check',
        entityType: 'lesson',
        entityId: id,
        summary: `${l.homeworkCheckedAt ? 'Changed the feedback on' : 'Checked'} homework "${short(title)}"`,
      });
      const student = await this.person(tx, 'student', l.studentId);
      await this.mail.enqueue(
        tx,
        student.email,
        'homework-checked',
        noticeEmail({
          name: student.name,
          title: 'Your homework was checked',
          lines: [`Your teacher replied to your homework "${title}".`],
          button: 'See the feedback',
          link: `${appUrl()}/student/lessons/${id}`,
        }),
      );
    });
    return this.lessons.get(user, id, now);
  }

  /** Answers waiting for feedback, oldest first: a teacher's own, or all for staff. */
  async toCheck(user: AuthUser, now = new Date()) {
    if (user.role === 'STUDENT') throw new ForbiddenException();
    const rows = await this.db
      .select({ id: lessons.id })
      .from(lessons)
      .where(
        and(
          isNotNull(lessons.homeworkSentAt),
          isNull(lessons.homeworkCheckedAt),
          user.role === 'TEACHER'
            ? eq(lessons.teacherId, user.teacherId!)
            : undefined,
        ),
      )
      .orderBy(asc(lessons.homeworkSentAt))
      .limit(100);
    const views = await this.lessons.viewsByIds(
      user,
      rows.map((r) => r.id),
      now,
    );
    const order = new Map(rows.map((r, i) => [r.id, i]));
    return views.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  }

  /** The files attached to a lesson's homework answer. */
  async files(user: AuthUser, id: string) {
    await this.lessons.get(user, id); // 404/403 as for the lesson
    return this.db
      .select(fileColumns)
      .from(homeworkFiles)
      .where(eq(homeworkFiles.lessonId, id))
      .orderBy(asc(homeworkFiles.createdAt));
  }

  async addFile(user: AuthUser, id: string, file: UploadedFile | undefined) {
    if (user.role !== 'STUDENT')
      throw new ForbiddenException(
        'The student attaches files to their homework.',
      );
    if (!file) throw new BadRequestException('Choose a file.');
    if (!HOMEWORK_FILE_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        'Send a photo (JPG, PNG, WEBP, HEIC), a PDF or a voice recording (MP3, M4A, WEBM, OGG, WAV).',
      );
    }
    if (file.size > HOMEWORK_FILE_MAX_BYTES)
      throw new BadRequestException('The file is too big: 8 MB at most.');
    const fileName =
      file.originalname.replace(/[\\/\r\n"]/g, '_').slice(0, 120) || 'homework';
    await this.db.transaction(async (tx) => {
      const [l] = await tx
        .select()
        .from(lessons)
        .where(eq(lessons.id, id))
        .for('update');
      if (!l || l.studentId !== user.studentId)
        throw new NotFoundException('Lesson not found.');
      if (!l.homeworkTitle && !l.homeworkBody)
        throw new ConflictException('This lesson has no homework.');
      if (l.homeworkCheckedAt)
        throw new ConflictException(
          'Your teacher already checked this homework.',
        );
      const [{ n }] = await tx
        .select({ n: count() })
        .from(homeworkFiles)
        .where(eq(homeworkFiles.lessonId, id));
      if (n >= HOMEWORK_FILES_PER_LESSON)
        throw new ConflictException(
          `Up to ${HOMEWORK_FILES_PER_LESSON} files per homework. Remove one first.`,
        );
      const [row] = await tx
        .insert(homeworkFiles)
        .values({
          lessonId: id,
          uploadedById: user.userId,
          fileName,
          contentType: file.mimetype,
          size: file.size,
          data: file.buffer,
        })
        .returning({ id: homeworkFiles.id });
      await this.audit.record(tx, user, {
        action: 'homework.file',
        entityType: 'lesson',
        entityId: id,
        summary: `Attached "${short(fileName, 40)}" to homework "${short(l.homeworkTitle || 'Homework')}"`,
        after: { fileId: row.id, size: file.size, contentType: file.mimetype },
      });
    });
    return this.files(user, id);
  }

  async removeFile(user: AuthUser, id: string, fileId: string) {
    if (user.role !== 'STUDENT') throw new ForbiddenException();
    await this.db.transaction(async (tx) => {
      const [l] = await tx
        .select()
        .from(lessons)
        .where(eq(lessons.id, id))
        .for('update');
      if (!l || l.studentId !== user.studentId)
        throw new NotFoundException('Lesson not found.');
      if (l.homeworkCheckedAt)
        throw new ConflictException(
          'Your teacher already checked this homework.',
        );
      const [gone] = await tx
        .delete(homeworkFiles)
        .where(
          and(eq(homeworkFiles.id, fileId), eq(homeworkFiles.lessonId, id)),
        )
        .returning({ fileName: homeworkFiles.fileName });
      if (!gone) throw new NotFoundException('File not found.');
      await this.audit.record(tx, user, {
        action: 'homework.file',
        entityType: 'lesson',
        entityId: id,
        summary: `Removed "${short(gone.fileName, 40)}" from the homework`,
      });
    });
    return this.files(user, id);
  }

  /** One file, for anyone who can see the lesson. */
  async download(user: AuthUser, id: string, fileId: string) {
    await this.lessons.get(user, id);
    const [f] = await this.db
      .select({
        fileName: homeworkFiles.fileName,
        contentType: homeworkFiles.contentType,
        data: homeworkFiles.data,
      })
      .from(homeworkFiles)
      .where(and(eq(homeworkFiles.id, fileId), eq(homeworkFiles.lessonId, id)));
    if (!f) throw new NotFoundException('File not found.');
    return f;
  }

  private async person(tx: Tx, kind: 'teacher' | 'student', id: string) {
    const [p] =
      kind === 'teacher'
        ? await tx
            .select({
              name: users.fullName,
              email: users.email,
              timezone: users.timezone,
            })
            .from(teachers)
            .innerJoin(users, eq(users.id, teachers.userId))
            .where(eq(teachers.id, id))
        : await tx
            .select({
              name: users.fullName,
              email: users.email,
              timezone: users.timezone,
            })
            .from(students)
            .innerJoin(users, eq(users.id, students.userId))
            .where(eq(students.id, id));
    return p;
  }
}
