import { ApiTags } from '@nestjs/swagger';
import {
  BadRequestException,
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
} from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { and, desc, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import {
  Area,
  type AuthUser,
  CurrentUser,
  Roles,
} from '../common/auth-user.js';
import { DB, type Db, type Executor } from '../db/db.module.js';
import { studentNotes, students, users } from '../db/schema.js';

class NoteDto {
  @IsString() @MinLength(1) @MaxLength(2000) body: string;
}

/** What the staff write about a student. Students and teachers never see it. */
@ApiTags('Students')
@Controller('students/:id/notes')
@Roles('ADMIN', 'STAFF')
export class StudentNotesController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  private async nameOf(exec: Executor, id: string): Promise<string> {
    const [row] = await exec
      .select({ name: users.fullName })
      .from(students)
      .innerJoin(users, eq(users.id, students.userId))
      .where(eq(students.id, id));
    if (!row) throw new NotFoundException('Student not found');
    return row.name;
  }

  @Get()
  async list(@Param('id', ParseUUIDPipe) id: string) {
    await this.nameOf(this.db, id);
    return this.db
      .select({
        id: studentNotes.id,
        body: studentNotes.body,
        createdAt: studentNotes.createdAt,
        authorId: studentNotes.authorId,
        authorName: users.fullName,
      })
      .from(studentNotes)
      .leftJoin(users, eq(users.id, studentNotes.authorId))
      .where(eq(studentNotes.studentId, id))
      .orderBy(desc(studentNotes.createdAt))
      .limit(200);
  }

  @Post()
  @Area('students')
  async add(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: NoteDto,
  ) {
    const text = body.body.trim();
    if (!text) throw new BadRequestException('The note is empty.');
    return this.db.transaction(async (tx) => {
      const name = await this.nameOf(tx, id);
      const [row] = await tx
        .insert(studentNotes)
        .values({ studentId: id, authorId: user.userId, body: text })
        .returning();
      const short = text.length > 80 ? `${text.slice(0, 77)}…` : text;
      await this.audit.record(tx, user, {
        action: 'student.note',
        entityType: 'student',
        entityId: id,
        summary: `Note about ${name}: "${short}"`,
      });
      return row;
    });
  }

  /** The author or an admin can remove a note. */
  @Delete(':noteId')
  @Area('students')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
  ) {
    await this.db.transaction(async (tx) => {
      const [note] = await tx
        .select()
        .from(studentNotes)
        .where(
          and(eq(studentNotes.id, noteId), eq(studentNotes.studentId, id)),
        );
      if (!note) throw new NotFoundException('Note not found');
      if (note.authorId !== user.userId && user.role !== 'ADMIN')
        throw new ForbiddenException(
          'Only the person who wrote it, or an admin, can remove a note.',
        );
      await tx.delete(studentNotes).where(eq(studentNotes.id, noteId));
      await this.audit.record(tx, user, {
        action: 'student.note-remove',
        entityType: 'student',
        entityId: id,
        summary: `Removed a note about ${await this.nameOf(tx, id)}`,
      });
    });
  }
}
