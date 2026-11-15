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
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import {
  Area,
  type AuthUser,
  CurrentUser,
  isStaff,
  Roles,
} from '../common/auth-user.js';
import { DB, type Db } from '../db/db.module.js';
import {
  curricula,
  curriculumFiles,
  lessons,
  teacherCurricula,
} from '../db/schema.js';

/** PDFs up to 30 MB. */
export const BOOK_MAX_BYTES = 30 * 1024 * 1024;

interface Upload {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

class BookDto {
  /** e.g. "Student book"; the file name when empty */
  @IsOptional() @IsString() @MaxLength(120) title?: string;
}

class OpenQuery {
  /** 1 = save the file instead of opening it */
  @IsOptional() @IsString() download?: string;
}

const columns = {
  id: curriculumFiles.id,
  curriculumId: curriculumFiles.curriculumId,
  title: curriculumFiles.title,
  fileName: curriculumFiles.fileName,
  size: curriculumFiles.size,
  createdAt: curriculumFiles.createdAt,
};

/**
 * Curriculum books (PDF). Staff with the curricula area upload and remove
 * them; a curriculum's teachers and students (anyone with a lesson in it)
 * can list and open them.
 */
@ApiTags('Curriculum books')
@Controller()
export class BooksController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /** Curricula this person may read books of; null = all (staff). */
  private async readable(user: AuthUser): Promise<string[] | null> {
    if (isStaff(user)) return null;
    if (user.role === 'TEACHER') {
      const rows = await this.db
        .select({ id: teacherCurricula.curriculumId })
        .from(teacherCurricula)
        .where(eq(teacherCurricula.teacherId, user.teacherId!));
      return rows.map((r) => r.id);
    }
    const rows = await this.db
      .selectDistinct({ id: lessons.curriculumId })
      .from(lessons)
      .where(eq(lessons.studentId, user.studentId!));
    return rows.map((r) => r.id);
  }

  private async assertCanRead(user: AuthUser, curriculumId: string) {
    const allowed = await this.readable(user);
    if (allowed && !allowed.includes(curriculumId))
      throw new NotFoundException();
  }

  /** The books of every curriculum I teach or study (staff: all), by curriculum. */
  @Get('my-books')
  async mine(@CurrentUser() user: AuthUser) {
    const allowed = await this.readable(user);
    if (allowed && !allowed.length) return [];
    const files = await this.db
      .select({ ...columns, curriculum: curricula.name })
      .from(curriculumFiles)
      .innerJoin(curricula, eq(curricula.id, curriculumFiles.curriculumId))
      .where(
        allowed ? inArray(curriculumFiles.curriculumId, allowed) : undefined,
      )
      .orderBy(asc(curricula.name), asc(curriculumFiles.title));
    const groups = new Map<
      string,
      { curriculumId: string; curriculum: string; files: typeof files }
    >();
    for (const f of files) {
      const g = groups.get(f.curriculumId) ?? {
        curriculumId: f.curriculumId,
        curriculum: f.curriculum,
        files: [],
      };
      g.files.push(f);
      groups.set(f.curriculumId, g);
    }
    return [...groups.values()];
  }

  @Get('curricula/:id/files')
  async list(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.assertCanRead(user, id);
    return this.db
      .select(columns)
      .from(curriculumFiles)
      .where(eq(curriculumFiles.curriculumId, id))
      .orderBy(asc(curriculumFiles.createdAt));
  }

  @Post('curricula/:id/files')
  @Roles('ADMIN', 'STAFF')
  @Area('catalog')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        title: { type: 'string' },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: BOOK_MAX_BYTES, files: 1 } }),
  )
  async upload(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: BookDto,
    @UploadedFile() file: Upload | undefined,
  ) {
    if (!file) throw new BadRequestException('Choose a PDF file.');
    const isPdf =
      file.mimetype === 'application/pdf' &&
      file.buffer.subarray(0, 5).toString('latin1') === '%PDF-';
    if (!isPdf) throw new BadRequestException('Only PDF files.');
    if (file.size > BOOK_MAX_BYTES)
      throw new BadRequestException('The file is too big: 30 MB at most.');
    const [curriculum] = await this.db
      .select({ name: curricula.name })
      .from(curricula)
      .where(eq(curricula.id, id));
    if (!curriculum) throw new NotFoundException('Curriculum not found');
    const fileName =
      file.originalname.replace(/[\\/\r\n"]/g, '_').slice(0, 120) || 'book.pdf';
    const title = body.title?.trim() || fileName.replace(/\.pdf$/i, '');
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(curriculumFiles)
        .values({
          curriculumId: id,
          title,
          fileName,
          contentType: 'application/pdf',
          size: file.size,
          data: file.buffer,
          uploadedById: user.userId,
        })
        .returning(columns);
      await this.audit.record(tx, user, {
        action: 'curriculum.file',
        entityType: 'curriculum',
        entityId: id,
        summary: `Added the book "${title}" (${(file.size / 1024 / 1024).toFixed(1)} MB) to ${curriculum.name}`,
      });
      return row;
    });
  }

  @Delete('curricula/:id/files/:fileId')
  @HttpCode(200)
  @Roles('ADMIN', 'STAFF')
  @Area('catalog')
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ) {
    return this.db.transaction(async (tx) => {
      const [gone] = await tx
        .delete(curriculumFiles)
        .where(
          and(
            eq(curriculumFiles.id, fileId),
            eq(curriculumFiles.curriculumId, id),
          ),
        )
        .returning({ title: curriculumFiles.title });
      if (!gone) throw new NotFoundException();
      const [c] = await tx
        .select({ name: curricula.name })
        .from(curricula)
        .where(eq(curricula.id, id));
      await this.audit.record(tx, user, {
        action: 'curriculum.file',
        entityType: 'curriculum',
        entityId: id,
        summary: `Removed the book "${gone.title}" from ${c?.name ?? 'a curriculum'}`,
      });
      return { id: fileId };
    });
  }

  /** The PDF itself: opens in the browser, or saves with ?download=1. */
  @Get('curricula/:id/files/:fileId')
  async open(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Query() q: OpenQuery,
  ) {
    await this.assertCanRead(user, id);
    const [f] = await this.db
      .select()
      .from(curriculumFiles)
      .where(
        and(
          eq(curriculumFiles.id, fileId),
          eq(curriculumFiles.curriculumId, id),
        ),
      );
    if (!f) throw new NotFoundException();
    if (!isStaff(user) && user.role !== 'TEACHER' && user.role !== 'STUDENT')
      throw new ForbiddenException();
    const kind = q.download === '1' ? 'attachment' : 'inline';
    return new StreamableFile(f.data, {
      type: f.contentType,
      length: f.data.length,
      disposition: `${kind}; filename*=UTF-8''${encodeURIComponent(f.fileName)}`,
    });
  }
}
