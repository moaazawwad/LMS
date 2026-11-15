import { ApiTags } from '@nestjs/swagger';
import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lt,
} from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { hashPassword } from '../auth/auth.service.js';
import {
  Area,
  type AuthUser,
  CurrentUser,
  isStaff,
  Roles,
} from '../common/auth-user.js';
import { DB, type Db } from '../db/db.module.js';
import {
  billingCycles,
  curricula,
  lessonCredits,
  lessons,
  plans,
  studentStatusEnum,
  students,
  subscriptions,
  teachers,
  users,
  weeklySlots,
} from '../db/schema.js';
import { cycleIndexFor } from '../rules/billing.js';
import { canEnterClass } from '../rules/lesson-rules.js';
import { localDateOf } from '../rules/schedule.js';

function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** An emptied field arrives as "": store nothing rather than a blank. */
const blankToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === ''
    ? null
    : typeof value === 'string'
      ? value.trim()
      : value;

/** The student's file beyond name, phone and address. All optional. */
export const STUDENT_PROFILE_KEYS = [
  'city',
  'gender',
  'birthDate',
  'whatsapp',
  'guardianName',
  'guardianRelation',
  'guardianPhone',
  'guardianEmail',
  'nativeLanguage',
  'otherLanguages',
  'level',
  'goals',
  'source',
  'joinedOn',
] as const;
type StudentProfileKey = (typeof STUDENT_PROFILE_KEYS)[number];

class StudentProfileDto {
  @IsOptional() @Transform(blankToNull) @IsString() @MaxLength(100) city?:
    string | null;
  @IsOptional() @Transform(blankToNull) @IsIn(['MALE', 'FEMALE']) gender?:
    string | null;
  @IsOptional()
  @Transform(blankToNull)
  @IsISO8601({ strict: true })
  birthDate?: string | null;
  @IsOptional() @Transform(blankToNull) @IsString() @MaxLength(40) whatsapp?:
    string | null;
  /** for a child: the parent or guardian the academy talks to */
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(120)
  guardianName?: string | null;
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(60)
  guardianRelation?: string | null;
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(40)
  guardianPhone?: string | null;
  @IsOptional() @Transform(blankToNull) @IsEmail() guardianEmail?:
    string | null;
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(60)
  nativeLanguage?: string | null;
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(200)
  otherLanguages?: string | null;
  /** where they are in their studies */
  @IsOptional() @Transform(blankToNull) @IsString() @MaxLength(200) level?:
    string | null;
  @IsOptional() @Transform(blankToNull) @IsString() @MaxLength(1000) goals?:
    string | null;
  /** how they found the academy */
  @IsOptional() @Transform(blankToNull) @IsString() @MaxLength(200) source?:
    string | null;
  @IsOptional()
  @Transform(blankToNull)
  @IsISO8601({ strict: true })
  joinedOn?: string | null;
}

/** The profile fields that were sent, dates cut to the day. */
function profileFields(body: StudentProfileDto) {
  const out: Partial<Record<StudentProfileKey, string | null>> = {};
  for (const key of STUDENT_PROFILE_KEYS) {
    const value = body[key];
    if (value === undefined) continue;
    out[key] =
      value && (key === 'birthDate' || key === 'joinedOn')
        ? value.slice(0, 10)
        : value;
  }
  return out;
}

class CreateStudentDto extends StudentProfileDto {
  @IsEmail() email: string;
  @IsString() @MinLength(2) fullName: string;
  @IsString() @MinLength(8) password: string;
  @IsOptional() @IsString() phone?: string;
  /** IANA zone, e.g. America/New_York */
  @IsString() timezone: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  /** ISO 3166 code: EG, US, GB... */
  @IsOptional()
  @Matches(/^[A-Z]{2}$/, { message: 'country must be a 2-letter code like EG' })
  country?: string;
}

class UpdateStudentDto extends StudentProfileDto {
  @IsOptional() @IsString() @MinLength(2) fullName?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsIn(studentStatusEnum.enumValues) status?:
    'ACTIVE' | 'PAUSED' | 'EXITED';
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsOptional()
  @Matches(/^[A-Z]{2}$/, { message: 'country must be a 2-letter code like EG' })
  country?: string;
}

@ApiTags('Students')
@Controller('students')
export class StudentsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Roles('ADMIN', 'STAFF')
  async list() {
    const rows = await this.db
      .select({
        id: students.id,
        userId: students.userId,
        fullName: users.fullName,
        email: users.email,
        phone: users.phone,
        timezone: users.timezone,
        status: students.status,
      })
      .from(students)
      .innerJoin(users, eq(users.id, students.userId))
      .orderBy(asc(users.fullName));
    const subs = await this.db.query.subscriptions.findMany({
      where: eq(subscriptions.status, 'ACTIVE'),
      with: {
        plan: true,
        teacher: { with: { user: { columns: { fullName: true } } } },
      },
    });
    return rows.map((s) => {
      const sub = subs.find((x) => x.studentId === s.id);
      return {
        ...s,
        plan: sub?.plan.tier ?? null,
        lessonsPerWeek: sub?.lessonsPerWeek ?? null,
        teacher: sub?.teacher.user.fullName ?? null,
        subscriptionId: sub?.id ?? null,
      };
    });
  }

  @Post()
  @Roles('ADMIN', 'STAFF')
  @Area('students')
  async create(@CurrentUser() actor: AuthUser, @Body() body: CreateStudentDto) {
    if (!isTimeZone(body.timezone))
      throw new ConflictException('Unknown time zone.');
    const email = body.email.trim().toLowerCase();
    return this.db.transaction(async (tx) => {
      const [exists] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email));
      if (exists) throw new ConflictException('This email is already used.');
      const [user] = await tx
        .insert(users)
        .values({
          email,
          fullName: body.fullName,
          phone: body.phone,
          role: 'STUDENT',
          timezone: body.timezone,
          passwordHash: await hashPassword(body.password),
        })
        .returning();
      const [student] = await tx
        .insert(students)
        .values({
          userId: user.id,
          address: body.address?.trim() || null,
          country: body.country ?? null,
          ...profileFields(body),
        })
        .returning();
      await this.audit.record(tx, actor, {
        action: 'student.create',
        entityType: 'student',
        entityId: student.id,
        summary: `Added student ${user.fullName} (${[body.country, body.timezone].filter(Boolean).join(', ')})`,
        after: {
          studentId: student.id,
          email,
          phone: body.phone ?? null,
          country: body.country ?? null,
          timezone: body.timezone,
        },
      });
      return { id: student.id, userId: user.id };
    });
  }

  @Get(':id')
  async get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    this.assertSelfOrStaff(user, id);
    const s = await this.db.query.students.findFirst({
      where: eq(students.id, id),
      with: {
        user: {
          columns: {
            fullName: true,
            email: true,
            phone: true,
            timezone: true,
            createdAt: true,
            isActive: true,
          },
        },
        subscriptions: {
          with: {
            plan: true,
            curriculum: true,
            slots: true,
            teacher: { with: { user: { columns: { fullName: true } } } },
          },
        },
      },
    });
    if (!s) throw new NotFoundException();
    const { isActive, ...profile } = s.user;
    return {
      id: s.id,
      userId: s.userId,
      status: s.status,
      address: s.address,
      country: s.country,
      ...(Object.fromEntries(
        STUDENT_PROFILE_KEYS.map((k) => [k, s[k]]),
      ) as Record<StudentProfileKey, string | null>),
      ...profile,
      /** false = this person can't sign in (turned off by staff). */
      signInActive: isActive,
      subscriptions: s.subscriptions.map((sub) => ({
        id: sub.id,
        status: sub.status,
        plan: { id: sub.plan.id, name: sub.plan.name, tier: sub.plan.tier },
        teacher: { id: sub.teacherId, name: sub.teacher.user.fullName },
        curriculum: sub.curriculum.name,
        lessonsPerWeek: sub.lessonsPerWeek,
        timezone: sub.timezone,
        startDate: sub.startDate,
        slots: sub.slots.map(({ weekday, startTime }) => ({
          weekday,
          startTime,
        })),
      })),
    };
  }

  @Patch(':id')
  @Roles('ADMIN', 'STAFF')
  @Area('students')
  async update(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateStudentDto,
  ) {
    if (body.timezone && !isTimeZone(body.timezone))
      throw new ConflictException('Unknown time zone.');
    return this.db.transaction(async (tx) => {
      const [before] = await tx
        .select({ student: students, user: users })
        .from(students)
        .innerJoin(users, eq(users.id, students.userId))
        .where(eq(students.id, id));
      if (!before) throw new NotFoundException();
      const { status, address, country, fullName, phone, timezone } = body;
      // Optional fields that were not sent arrive as undefined: leave them out.
      const userFields = Object.fromEntries(
        Object.entries({ fullName, phone, timezone }).filter(
          ([, v]) => v !== undefined,
        ),
      );
      const profile = profileFields(body);
      const studentFields = {
        ...(status ? { status } : {}),
        ...(address !== undefined ? { address: address.trim() || null } : {}),
        ...(country !== undefined ? { country } : {}),
        ...profile,
      };
      if (Object.keys(studentFields).length)
        await tx.update(students).set(studentFields).where(eq(students.id, id));
      if (Object.keys(userFields).length)
        await tx
          .update(users)
          .set(userFields)
          .where(eq(users.id, before.user.id));
      await this.audit.record(tx, actor, {
        action: 'student.update',
        entityType: 'student',
        entityId: id,
        summary: status
          ? `Student status ${before.student.status} → ${status}`
          : `Updated ${before.user.fullName}'s profile`,
        before: {
          status: before.student.status,
          fullName: before.user.fullName,
          phone: before.user.phone,
          timezone: before.user.timezone,
          address: before.student.address,
          country: before.student.country,
          ...Object.fromEntries(
            (Object.keys(profile) as StudentProfileKey[]).map((k) => [
              k,
              before.student[k],
            ]),
          ),
        },
        after: body,
      });
      return { id };
    });
  }

  /** Everything the student home page (and the admin profile) needs in one call. */
  @Get(':id/overview')
  async overview(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    this.assertSelfOrStaff(user, id);
    const now = new Date();
    const [sub] = await this.db
      .select({
        sub: subscriptions,
        plan: plans,
        curriculum: curricula.name,
        teacherName: users.fullName,
        teacherLink: teachers.zoomLink,
      })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .innerJoin(curricula, eq(curricula.id, subscriptions.curriculumId))
      .innerJoin(teachers, eq(teachers.id, subscriptions.teacherId))
      .innerJoin(users, eq(users.id, teachers.userId))
      .where(
        and(
          eq(subscriptions.studentId, id),
          eq(subscriptions.status, 'ACTIVE'),
        ),
      )
      .orderBy(desc(subscriptions.createdAt))
      .limit(1);

    let cycle = null;
    let slots: { weekday: number; startTime: string }[] = [];
    if (sub) {
      slots = await this.db
        .select({
          weekday: weeklySlots.weekday,
          startTime: weeklySlots.startTime,
        })
        .from(weeklySlots)
        .where(eq(weeklySlots.subscriptionId, sub.sub.id))
        .orderBy(asc(weeklySlots.weekday));
      const today = localDateOf(now, sub.sub.timezone);
      if (today >= sub.sub.startDate) {
        const index = cycleIndexFor(sub.sub.startDate, today);
        const [row] = await this.db
          .select()
          .from(billingCycles)
          .where(
            and(
              eq(billingCycles.subscriptionId, sub.sub.id),
              eq(billingCycles.index, index),
            ),
          );
        cycle = row ?? null;
      }
    }

    const [{ pendingCredits }] = await this.db
      .select({ pendingCredits: count() })
      .from(lessonCredits)
      .where(
        and(
          eq(lessonCredits.studentId, id),
          eq(lessonCredits.status, 'PENDING'),
        ),
      );

    const upcoming = await this.db
      .select({ lesson: lessons, teacherName: users.fullName })
      .from(lessons)
      .innerJoin(teachers, eq(teachers.id, lessons.teacherId))
      .innerJoin(users, eq(users.id, teachers.userId))
      .where(
        and(
          eq(lessons.studentId, id),
          eq(lessons.status, 'SCHEDULED'),
          gte(lessons.startsAt, new Date(now.getTime() - 3_600_000)),
        ),
      )
      .orderBy(asc(lessons.startsAt))
      .limit(6);

    // The newest homework from a lesson that already started (attended or not).
    const [lastWithNotes] = await this.db
      .select()
      .from(lessons)
      .where(
        and(
          eq(lessons.studentId, id),
          inArray(lessons.status, ['COMPLETED', 'SCHEDULED']),
          lt(lessons.startsAt, now),
          isNotNull(lessons.homeworkTitle),
        ),
      )
      .orderBy(desc(lessons.startsAt))
      .limit(1);

    return {
      subscription: sub
        ? {
            id: sub.sub.id,
            timezone: sub.sub.timezone,
            lessonsPerWeek: sub.sub.lessonsPerWeek,
            curriculum: sub.curriculum,
            teacher: sub.teacherName,
            teacherId: sub.sub.teacherId,
            /** the teacher's meeting room, to send the student quickly */
            teacherLink: sub.teacherLink,
            plan: {
              name: sub.plan.name,
              tier: sub.plan.tier,
              cancelQuota: sub.plan.cancelQuota,
              rescheduleQuota: sub.plan.rescheduleQuota,
            },
            slots,
          }
        : null,
      cycle: cycle
        ? {
            index: cycle.index,
            startDate: cycle.startDate,
            endDate: cycle.endDate,
            cancelsUsed: cycle.cancelsUsed,
            reschedulesUsed: cycle.reschedulesUsed,
          }
        : null,
      pendingCredits,
      upcoming: upcoming
        .filter(
          (u) =>
            u.lesson.startsAt.getTime() + u.lesson.durationMin * 60_000 >
            now.getTime(),
        )
        .map((u) => ({
          id: u.lesson.id,
          startsAt: u.lesson.startsAt,
          durationMin: u.lesson.durationMin,
          type: u.lesson.type,
          teacher: u.teacherName,
          canEnter:
            user.role === 'STUDENT' &&
            canEnterClass(u.lesson.startsAt, u.lesson.durationMin, now),
        })),
      lastLesson: lastWithNotes
        ? {
            id: lastWithNotes.id,
            startsAt: lastWithNotes.startsAt,
            notes: lastWithNotes.notes,
            homeworkTitle: lastWithNotes.homeworkTitle,
            homeworkBody: lastWithNotes.homeworkBody,
            homeworkSentAt: lastWithNotes.homeworkSentAt,
            homeworkCheckedAt: lastWithNotes.homeworkCheckedAt,
          }
        : null,
    };
  }

  private assertSelfOrStaff(user: AuthUser, studentId: string) {
    if (isStaff(user)) return;
    if (user.role === 'STUDENT' && user.studentId === studentId) return;
    throw new ForbiddenException();
  }
}
