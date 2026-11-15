import { ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { and, asc, desc, eq, gte, inArray, isNotNull, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DateTime } from 'luxon';
import { AuditService } from '../audit/audit.service.js';
import {
  Area,
  type AuthUser,
  CurrentUser,
  Roles,
} from '../common/auth-user.js';
import { teacherName } from '../common/names.js';
import { DB, type Db } from '../db/db.module.js';
import {
  lessons,
  students,
  teacherBankDetails,
  teacherNotes,
  teachers,
  users,
} from '../db/schema.js';
import { ACADEMY_TZ } from '../rules/schedule.js';

const blankToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === ''
    ? null
    : value?.toString().trim();

class BankDto {
  @IsOptional()
  @Transform(blankToNull)
  @IsIn(['BANK', 'INSTAPAY', 'WALLET', 'CASH'])
  method?: string | null;
  @IsOptional() @Transform(blankToNull) @IsString() @MaxLength(100) bankName?:
    string | null;
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(120)
  accountHolder?: string | null;
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(40)
  accountNumber?: string | null;
  @IsOptional() @Transform(blankToNull) @IsString() @MaxLength(40) iban?:
    string | null;
  @IsOptional() @Transform(blankToNull) @IsString() @MaxLength(100) instapay?:
    string | null;
  @IsOptional() @Transform(blankToNull) @IsString() @MaxLength(30) wallet?:
    string | null;
  @IsOptional() @Transform(blankToNull) @IsString() @MaxLength(500) notes?:
    string | null;
}
const BANK_KEYS = [
  'method',
  'bankName',
  'accountHolder',
  'accountNumber',
  'iban',
  'instapay',
  'wallet',
  'notes',
] as const;
const BANK_LABEL: Record<(typeof BANK_KEYS)[number], string> = {
  method: 'how they are paid',
  bankName: 'bank',
  accountHolder: 'account holder',
  accountNumber: 'account number',
  iban: 'IBAN',
  instapay: 'InstaPay',
  wallet: 'wallet',
  notes: 'notes',
};

class NoteDto {
  @IsString() @MinLength(2) @MaxLength(2000) body: string;
}

/** What happened in a lesson, from the teacher's side. */
type Incident = 'NO_SHOW' | 'CANCELLED' | 'NOBODY_CAME' | 'STUDENT_ABSENT';

/**
 * The parts of a teacher's profile on their own tabs: how they are paid
 * (admins only), staff notes about them, and their attendance record.
 */
@ApiTags('Teachers')
@Controller('teachers/:id')
@Roles('ADMIN', 'STAFF')
@Area('teachers')
export class TeacherProfileController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  private async exists(id: string) {
    const [t] = await this.db
      .select({ id: teachers.id })
      .from(teachers)
      .where(eq(teachers.id, id));
    if (!t) throw new NotFoundException('Teacher not found');
  }

  // ----- bank details: admins only, kept out of the log -----

  @Get('bank')
  async bank(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (user.role !== 'ADMIN')
      throw new ForbiddenException('Only admins see payment details.');
    await this.exists(id);
    const [row] = await this.db
      .select()
      .from(teacherBankDetails)
      .where(eq(teacherBankDetails.teacherId, id));
    const empty = Object.fromEntries(BANK_KEYS.map((k) => [k, null]));
    return row
      ? { ...empty, ...row }
      : { teacherId: id, ...empty, updatedAt: null };
  }

  @Put('bank')
  async setBank(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: BankDto,
  ) {
    if (user.role !== 'ADMIN')
      throw new ForbiddenException('Only admins change payment details.');
    await this.exists(id);
    return this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(teacherBankDetails)
        .where(eq(teacherBankDetails.teacherId, id));
      const values = Object.fromEntries(
        BANK_KEYS.filter((k) => body[k] !== undefined).map((k) => [
          k,
          body[k] ?? null,
        ]),
      ) as Partial<typeof teacherBankDetails.$inferInsert>;
      if (typeof values.iban === 'string')
        values.iban = values.iban.replace(/\s+/g, '').toUpperCase();
      const [row] = await tx
        .insert(teacherBankDetails)
        .values({ teacherId: id, ...values, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: teacherBankDetails.teacherId,
          set: { ...values, updatedAt: new Date() },
        })
        .returning();
      // The log says what changed, never the numbers themselves.
      const changed = BANK_KEYS.filter(
        (k) => (before?.[k] ?? null) !== (row[k] ?? null),
      );
      if (changed.length)
        await this.audit.record(tx, user, {
          action: 'teacher.bank',
          entityType: 'teacher',
          entityId: id,
          summary: `Changed ${await teacherName(tx, id)}'s payment details: ${changed.map((k) => BANK_LABEL[k]).join(', ')}`,
        });
      return row;
    });
  }

  // ----- notes by staff -----

  @Get('notes')
  async notes(@Param('id', ParseUUIDPipe) id: string) {
    await this.exists(id);
    return this.db
      .select({
        id: teacherNotes.id,
        body: teacherNotes.body,
        createdAt: teacherNotes.createdAt,
        authorId: teacherNotes.authorId,
        authorName: users.fullName,
      })
      .from(teacherNotes)
      .leftJoin(users, eq(users.id, teacherNotes.authorId))
      .where(eq(teacherNotes.teacherId, id))
      .orderBy(desc(teacherNotes.createdAt))
      .limit(200);
  }

  @Post('notes')
  async addNote(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: NoteDto,
  ) {
    await this.exists(id);
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(teacherNotes)
        .values({
          teacherId: id,
          authorId: user.userId,
          body: body.body.trim(),
        })
        .returning();
      const short =
        row.body.length > 80 ? `${row.body.slice(0, 77)}…` : row.body;
      await this.audit.record(tx, user, {
        action: 'teacher.note',
        entityType: 'teacher',
        entityId: id,
        summary: `Note about ${await teacherName(tx, id)}: "${short}"`,
      });
      return row;
    });
  }

  /** The author or an admin can remove a note. */
  @Delete('notes/:noteId')
  @HttpCode(204)
  async removeNote(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
  ) {
    await this.db.transaction(async (tx) => {
      const [note] = await tx
        .select()
        .from(teacherNotes)
        .where(
          and(eq(teacherNotes.id, noteId), eq(teacherNotes.teacherId, id)),
        );
      if (!note) throw new NotFoundException('Note not found');
      if (note.authorId !== user.userId && user.role !== 'ADMIN')
        throw new ForbiddenException(
          'Only the person who wrote it, or an admin, can remove a note.',
        );
      await tx.delete(teacherNotes).where(eq(teacherNotes.id, noteId));
      await this.audit.record(tx, user, {
        action: 'teacher.note-remove',
        entityType: 'teacher',
        entityId: id,
        summary: `Removed a note about ${await teacherName(tx, id)}`,
      });
    });
  }

  // ----- attendance record -----

  /**
   * The last 6 Cairo months: lessons held, and each time the teacher did not
   * come, cancelled, or nobody came; newest first.
   */
  @Get('record')
  async record(@Param('id', ParseUUIDPipe) id: string) {
    await this.exists(id);
    const now = DateTime.now().setZone(ACADEMY_TZ);
    const first = now.startOf('month').minus({ months: 5 });
    const rows = await this.db
      .select({
        id: lessons.id,
        startsAt: lessons.startsAt,
        durationMin: lessons.durationMin,
        status: lessons.status,
        attendance: lessons.attendance,
        cancelReason: lessons.cancelReason,
        cancelledAt: lessons.cancelledAt,
        makeupOwed: lessons.makeupOwed,
        studentId: lessons.studentId,
      })
      .from(lessons)
      .where(
        and(
          eq(lessons.teacherId, id),
          gte(lessons.startsAt, first.toJSDate()),
          or(isNotNull(lessons.closedAt), eq(lessons.status, 'CANCELLED')),
        ),
      )
      .orderBy(asc(lessons.startsAt));

    const kindOf = (l: (typeof rows)[number]): Incident | 'HELD' | null => {
      if (l.status === 'CANCELLED') {
        if (l.cancelReason !== 'BY_TEACHER') return null;
        return l.cancelledAt && l.cancelledAt >= l.startsAt
          ? 'NO_SHOW'
          : 'CANCELLED';
      }
      if (l.startsAt > now.toJSDate()) return null;
      if (l.attendance === 'NONE') return 'NOBODY_CAME';
      if (l.attendance === 'TEACHER_ONLY') return 'STUDENT_ABSENT';
      if (l.attendance === 'BOTH' || l.status === 'COMPLETED') return 'HELD';
      return null;
    };

    const months = Array.from({ length: 6 }, (_, i) => {
      const m = first.plus({ months: i });
      return {
        month: m.toFormat('yyyy-MM'),
        label: m.toFormat('LLL yyyy'),
        held: 0,
        heldMinutes: 0,
        studentAbsent: 0,
        noShow: 0,
        cancelled: 0,
        nobodyCame: 0,
      };
    });
    const incidents: {
      lessonId: string;
      startsAt: Date;
      kind: Incident;
      studentId: string;
      makeupOwed: boolean;
    }[] = [];
    for (const l of rows) {
      const kind = kindOf(l);
      if (!kind) continue;
      const m = months.find(
        (x) =>
          x.month ===
          DateTime.fromJSDate(l.startsAt, { zone: ACADEMY_TZ }).toFormat(
            'yyyy-MM',
          ),
      );
      if (!m) continue;
      if (kind === 'HELD') {
        m.held++;
        m.heldMinutes += l.durationMin;
        continue;
      }
      if (kind === 'STUDENT_ABSENT') m.studentAbsent++;
      if (kind === 'NO_SHOW') m.noShow++;
      if (kind === 'CANCELLED') m.cancelled++;
      if (kind === 'NOBODY_CAME') m.nobodyCame++;
      if (kind !== 'STUDENT_ABSENT')
        incidents.push({
          lessonId: l.id,
          startsAt: l.startsAt,
          kind,
          studentId: l.studentId,
          makeupOwed: l.makeupOwed,
        });
    }
    // Student names for the incidents.
    const su = alias(users, 'student_user');
    const ids = [...new Set(incidents.map((i) => i.studentId))];
    const names = new Map(
      ids.length
        ? (
            await this.db
              .select({ id: students.id, name: su.fullName })
              .from(students)
              .innerJoin(su, eq(su.id, students.userId))
              .where(inArray(students.id, ids))
          ).map((r) => [r.id, r.name])
        : [],
    );
    return {
      months: months.reverse(),
      incidents: incidents
        .reverse()
        .map((i) => ({ ...i, studentName: names.get(i.studentId) ?? '' })),
    };
  }
}
