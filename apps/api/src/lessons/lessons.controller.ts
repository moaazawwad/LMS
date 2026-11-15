import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  Matches,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  Area,
  type AuthUser,
  CurrentUser,
  Roles,
} from '../common/auth-user.js';
import {
  cancelReasonEnum,
  type CancelReason,
  lessonStatusEnum,
  type LessonStatus,
} from '../db/schema.js';
import type { ReviewOutcome, TeacherRemedy } from '../rules/lesson-rules.js';
import { AttendanceService } from './attendance.service.js';
import {
  HOMEWORK_FILE_MAX_BYTES,
  HomeworkService,
  type UploadedFile as HomeworkUpload,
} from './homework.service.js';
import { ScheduleCheckService } from './schedule-check.service.js';
import { type LessonKind, LessonsService } from './lessons.service.js';

class LessonQueryDto {
  @IsOptional() @Type(() => Date) @IsDate() from?: Date;
  @IsOptional() @Type(() => Date) @IsDate() to?: Date;
  @IsOptional() @IsUUID() teacherId?: string;
  @IsOptional() @IsUUID() studentId?: string;
  @IsOptional() @IsIn(lessonStatusEnum.enumValues) status?: LessonStatus;
  @IsOptional() @IsIn(['asc', 'desc']) order?: 'asc' | 'desc';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
  @IsOptional()
  @IsIn(['regular', 'trial', 'extra', 'cancelled', 'rescheduled'])
  kind?: LessonKind;
  @IsOptional() @IsUUID() curriculumId?: string;
}

class OverrideDto {
  /** staff only: go past a rule. A note is then required. */
  @IsOptional() @IsBoolean() override?: boolean;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

class CancelDto extends OverrideDto {
  @IsOptional() @IsIn(cancelReasonEnum.enumValues) reason?: CancelReason;
  @IsOptional() @IsIn(['MAKEUP', 'CREDIT']) teacherRemedy?: TeacherRemedy;
}

class RescheduleDto extends OverrideDto {
  @Type(() => Date) @IsDate() startsAt: Date;
  @IsOptional() @IsIn(['STUDENT', 'TEACHER', 'ADMIN']) requestedBy?:
    'STUDENT' | 'TEACHER' | 'ADMIN';
}

class TransferDto extends OverrideDto {
  @IsUUID() teacherId: string;
}

class HomeworkAnswerDto {
  @IsString() @MaxLength(5000) answer: string;
}

class HomeworkFeedbackDto {
  @IsString() @MaxLength(5000) feedback: string;
}

class NotesDto {
  @IsOptional() @IsString() @MaxLength(5000) notes?: string;
  @IsOptional() @IsString() @MaxLength(200) homeworkTitle?: string;
  @IsOptional() @IsString() @MaxLength(5000) homeworkBody?: string;
}

class FreeSlotsDto {
  /** the student's local date, YYYY-MM-DD */
  @IsISO8601({ strict: true }) date: string;
}

class ExtraDto extends OverrideDto {
  @IsUUID() subscriptionId: string;
  @Type(() => Date) @IsDate() startsAt: Date;
  @IsIn(['MAKEUP', 'OTHER']) extraReason: 'MAKEUP' | 'OTHER';
  /** MAKEUP only: the owed lesson this one replaces */
  @IsOptional() @IsUUID() forLessonId?: string;
  /** another teacher for this one lesson (default: the subscription's) */
  @IsOptional() @IsUUID() teacherId?: string;
  /** another curriculum for this one lesson (default: the subscription's) */
  @IsOptional() @IsUUID() curriculumId?: string;
}

class TrialDto extends OverrideDto {
  @IsUUID() studentId: string;
  @IsUUID() teacherId: string;
  @IsUUID() curriculumId: string;
  @Type(() => Date) @IsDate() startsAt: Date;
  /** 30 or 60 minutes */
  @IsIn([30, 60]) durationMin: number;
}

class TeacherFreeQuery {
  @IsUUID() teacherId: string;
  @IsUUID() studentId: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) date: string;
  @Type(() => Number) @IsIn([30, 60]) durationMin: number;
}

class ScheduleCheckQuery {
  /** days ahead to check, 7-90 (default 42) */
  @IsOptional() @Type(() => Number) @IsInt() @Min(7) @Max(90) days?: number;
}

class MakeupsQuery {
  @IsOptional() @IsUUID() studentId?: string;
}

class ReviewDto {
  /** what happened. Allowed values depend on who entered (see reviewOptions on the lesson). */
  @IsIn(['CONFIRM', 'HELD', 'STUDENT_ABSENT', 'NOBODY_CAME', 'TEACHER_ABSENT'])
  outcome: ReviewOutcome;
  /** TEACHER_ABSENT only: a makeup lesson or a credit on the next invoice (default) */
  @IsOptional() @IsIn(['MAKEUP', 'CREDIT']) teacherRemedy?: TeacherRemedy;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

@ApiTags('Lessons')
@Controller('lessons')
export class LessonsController {
  constructor(
    private readonly lessons: LessonsService,
    private readonly attendance: AttendanceService,
    private readonly scheduleCheck: ScheduleCheckService,
    private readonly homework: HomeworkService,
  ) {}

  /** Teachers and students only ever get their own lessons. */
  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: LessonQueryDto) {
    return this.lessons.list(user, q);
  }

  @Get('today')
  today(@CurrentUser() user: AuthUser) {
    return this.lessons.today(user);
  }

  /** Finished lessons not attended by both that nobody has checked yet, oldest first. */
  @Get('attendance-review')
  @Roles('ADMIN', 'STAFF')
  toReview(@CurrentUser() user: AuthUser) {
    return this.attendance.toReview(user);
  }

  /**
   * Upcoming lessons outside the teacher's hours or clashing with another
   * lesson, the clock changes coming up, and how many lessons they move.
   */
  @Get('schedule-check')
  @Roles('ADMIN', 'STAFF')
  checkSchedule(@CurrentUser() user: AuthUser, @Query() q: ScheduleCheckQuery) {
    return this.scheduleCheck.check(user, q.days);
  }

  /** Lessons the teacher cancelled with a makeup chosen, not booked yet. */
  /** Homework answers waiting for feedback: a teacher's own, or all for staff. */
  @Get('homework-to-check')
  @Roles('TEACHER', 'ADMIN', 'STAFF')
  homeworkToCheck(@CurrentUser() user: AuthUser) {
    return this.homework.toCheck(user);
  }

  /** The student sends (or changes) their homework answer. */
  @Post(':id/homework')
  @HttpCode(200)
  @Roles('STUDENT')
  sendHomework(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: HomeworkAnswerDto,
  ) {
    return this.homework.send(user, id, body.answer);
  }

  /** Files attached to the homework answer (photos, PDFs, recordings). */
  @Get(':id/homework/files')
  homeworkFiles(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.homework.files(user, id);
  }

  /** The student attaches a file (form field "file", 8 MB at most, 3 per homework). */
  @Post(':id/homework/files')
  @Roles('STUDENT')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: HOMEWORK_FILE_MAX_BYTES, files: 1 },
    }),
  )
  addHomeworkFile(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: HomeworkUpload | undefined,
  ) {
    return this.homework.addFile(user, id, file);
  }

  @Delete(':id/homework/files/:fileId')
  @Roles('STUDENT')
  removeHomeworkFile(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ) {
    return this.homework.removeFile(user, id, fileId);
  }

  @Get(':id/homework/files/:fileId')
  async homeworkFile(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ) {
    const f = await this.homework.download(user, id, fileId);
    return new StreamableFile(f.data, {
      type: f.contentType,
      length: f.data.length,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(f.fileName)}`,
    });
  }

  /** The teacher (or the academy) replies to the answer. */
  @Post(':id/homework/feedback')
  @HttpCode(200)
  @Roles('TEACHER', 'ADMIN', 'STAFF')
  @Area('lessons')
  checkHomework(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: HomeworkFeedbackDto,
  ) {
    return this.homework.check(user, id, body.feedback);
  }

  @Get('makeups-owed')
  @Roles('ADMIN', 'STAFF')
  makeupsOwed(@CurrentUser() user: AuthUser, @Query() q: MakeupsQuery) {
    return this.lessons.makeupsOwed(user, q);
  }

  /** A teacher's free times on the student's day, for booking a trial lesson. */
  @Get('trial-slots')
  @Roles('ADMIN', 'STAFF')
  trialSlots(@Query() q: TeacherFreeQuery) {
    return this.lessons.freeSlotsForTeacher({
      teacherId: q.teacherId,
      studentId: q.studentId,
      localDate: q.date,
      durationMin: q.durationMin,
    });
  }

  /** A free one-off trial lesson (no subscription, no invoice). */
  @Post('trial')
  @Roles('ADMIN', 'STAFF')
  @Area('lessons')
  addTrial(@CurrentUser() user: AuthUser, @Body() body: TrialDto) {
    return this.lessons.addTrial(user, body);
  }

  @Post('extra')
  @Roles('ADMIN', 'STAFF')
  @Area('lessons')
  addExtra(@CurrentUser() user: AuthUser, @Body() body: ExtraDto) {
    return this.lessons.addExtra(user, body);
  }

  /** Staff: where a lesson came from and went, its invoice, credit or charge. */
  @Get(':id/history')
  @Roles('ADMIN', 'STAFF')
  history(@Param('id', ParseUUIDPipe) id: string) {
    return this.lessons.history(id);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.lessons.get(user, id);
  }

  @Post(':id/enter')
  @HttpCode(200)
  enter(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.lessons.enter(user, id);
  }

  /** Staff record what happened when someone did not enter class. */
  @Post(':id/attendance')
  @HttpCode(200)
  @Roles('ADMIN', 'STAFF')
  @Area('lessons')
  review(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReviewDto,
  ) {
    return this.attendance.review(user, id, body);
  }

  @Post(':id/cancel')
  @Area('lessons')
  @HttpCode(200)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CancelDto,
  ) {
    return this.lessons.cancel(user, id, body);
  }

  @Post(':id/reschedule')
  @Area('lessons')
  reschedule(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RescheduleDto,
  ) {
    return this.lessons.reschedule(user, id, body);
  }

  @Post(':id/transfer')
  @Roles('ADMIN', 'STAFF')
  @Area('lessons')
  transfer(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: TransferDto,
  ) {
    return this.lessons.transfer(user, id, body);
  }

  @Patch(':id/notes')
  @Roles('TEACHER', 'ADMIN', 'STAFF')
  notes(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: NotesDto,
  ) {
    return this.lessons.saveNotes(user, id, body);
  }

  @Get(':id/free-slots')
  freeSlots(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: FreeSlotsDto,
  ) {
    return this.lessons.freeSlots(user, id, q.date);
  }
}
