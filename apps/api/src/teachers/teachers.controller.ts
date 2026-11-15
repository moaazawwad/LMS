import { ApiTags } from '@nestjs/swagger';
import {
  BadRequestException,
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
  Put,
  Query,
} from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  Min,
  Length,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { and, asc, eq, gte, inArray } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { hashPassword } from '../auth/auth.service.js';
import {
  Area,
  type AuthUser,
  CurrentUser,
  isStaff,
  Roles,
} from '../common/auth-user.js';
import { DB, type Db, type Tx } from '../db/db.module.js';
import { LessonsService } from '../lessons/lessons.service.js';
import { SchedulingService } from '../lessons/scheduling.service.js';
import {
  availabilityWindows,
  curricula,
  lessons,
  subscriptions,
  teacherCurricula,
  teacherStatusEnum,
  teachers,
  tierEnum,
  type Tier,
  users,
} from '../db/schema.js';
import {
  ACADEMY_TZ,
  fitsAvailability,
  localDateOf,
} from '../rules/schedule.js';
import { teacherRate } from './pay-rate.js';
import { teacherName } from '../common/names.js';

/** Empty text means "not given". */
const blankToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? null : value;

/** Personal details: all optional, empty clears. */
class TeacherProfileDto {
  @IsOptional() @Transform(blankToNull) @IsIn(['MALE', 'FEMALE']) gender?:
    string | null;
  @IsOptional()
  @Transform(blankToNull)
  @IsISO8601({ strict: true })
  birthDate?: string | null;
  @IsOptional() @Transform(blankToNull) @IsString() @Length(2, 2) country?:
    string | null;
  @IsOptional() @Transform(blankToNull) @IsString() @MaxLength(80) city?:
    string | null;
  @IsOptional() @Transform(blankToNull) @IsString() @MaxLength(300) address?:
    string | null;
  @IsOptional() @Transform(blankToNull) @IsString() @MaxLength(200) languages?:
    string | null;
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(1000)
  education?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(70) experienceYears?: number | null;
  @IsOptional()
  @Transform(blankToNull)
  @IsISO8601({ strict: true })
  joinedOn?: string | null;
}

const PROFILE_KEYS = [
  'gender',
  'birthDate',
  'country',
  'city',
  'address',
  'languages',
  'education',
  'experienceYears',
  'joinedOn',
] as const;

class CreateTeacherDto extends TeacherProfileDto {
  @IsEmail() email: string;
  @IsString() @MinLength(2) fullName: string;
  @IsString() @MinLength(8) password: string;
  @IsOptional() @IsString() phone?: string;
  @IsIn(tierEnum.enumValues) level: Tier;
  @IsOptional() @IsUrl() zoomLink?: string;
  @IsOptional() @IsString() bio?: string;
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  curriculumIds: string[];
  /** admins only: pay per hour of lessons, in cents */
  @IsOptional() @IsInt() @Min(0) @Max(10_000_000) hourlyRateCents?:
    number | null;
  /** admins only, e.g. EGP */
  @IsOptional() @IsString() @Length(3, 3) rateCurrency?: string;
}

class UpdateTeacherDto extends TeacherProfileDto {
  @IsOptional() @IsString() @MinLength(2) fullName?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsIn(tierEnum.enumValues) level?: Tier;
  @IsOptional() @IsIn(teacherStatusEnum.enumValues) status?:
    'ACTIVE' | 'INACTIVE';
  @IsOptional() @IsUrl() zoomLink?: string;
  @IsOptional() @IsString() bio?: string;
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  curriculumIds?: string[];
  /** admins only: pay per hour of lessons, in cents; null clears it */
  @IsOptional() @IsInt() @Min(0) @Max(10_000_000) hourlyRateCents?:
    number | null;
  /** admins only, e.g. EGP */
  @IsOptional() @IsString() @Length(3, 3) rateCurrency?: string;
}

/** Pay is for admins: staff can't set it, and the log (which staff read) never shows it. */
function assertCanSetPay(
  actor: AuthUser,
  body: { hourlyRateCents?: number | null; rateCurrency?: string },
) {
  if (
    (body.hourlyRateCents !== undefined || body.rateCurrency !== undefined) &&
    actor.role !== 'ADMIN'
  ) {
    throw new ForbiddenException('Only admins set pay rates.');
  }
}
/** The personal details that were sent (country in capitals). */
function profileOf(body: TeacherProfileDto) {
  const out: Partial<
    Pick<typeof teachers.$inferInsert, (typeof PROFILE_KEYS)[number]>
  > = {};
  for (const k of PROFILE_KEYS)
    if (body[k] !== undefined)
      (out as Record<string, unknown>)[k] = body[k] ?? null;
  if (typeof out.country === 'string') out.country = out.country.toUpperCase();
  return out;
}

const withoutPay = <T extends object>(row: T) => {
  const {
    hourlyRateCents: _rate,
    rateCurrency: _cur,
    ...rest
  } = row as T & { hourlyRateCents?: unknown; rateCurrency?: unknown };
  return rest;
};

class WindowDto {
  @IsInt() @Min(1) @Max(7) weekday: number;
  @IsInt() @Min(0) @Max(1439) startMinute: number;
  @IsInt() @Min(1) @Max(1440) endMinute: number;
}

class AvailabilityDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WindowDto)
  windows: WindowDto[];
}

class WeeklyFreeQuery {
  /** the student's IANA time zone, e.g. America/New_York */
  @IsString()
  @IsIn(Intl.supportedValuesOf('timeZone').concat('UTC'))
  timezone: string;
  /** first day of the cycle, YYYY-MM-DD on the student's clock */
  @IsISO8601({ strict: true }) startDate: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(180)
  durationMin?: number;
  @IsOptional() @Type(() => Number) @IsIn([15, 30, 60]) stepMin?: number;
  /** when changing an existing subscription's times, ignore its own lessons */
  @IsOptional() @IsUUID() excludeSubscriptionId?: string;
}

@ApiTags('Teachers')
@Controller('teachers')
export class TeachersController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly scheduling: SchedulingService,
    private readonly lessons: LessonsService,
  ) {}

  /**
   * Weekly start times that are free every week of a first cycle starting on
   * `startDate`, on the student's clock. Use it to pick recurring slots.
   */
  @Get(':id/weekly-free')
  @Roles('ADMIN', 'STAFF')
  weeklyFree(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: WeeklyFreeQuery,
  ) {
    return this.scheduling.weeklyFree(this.db, {
      teacherId: id,
      timezone: q.timezone,
      startDate: q.startDate,
      durationMin: q.durationMin ?? 60,
      stepMin: q.stepMin ?? 60,
      excludeSubscriptionId: q.excludeSubscriptionId,
    });
  }

  @Get()
  @Roles('ADMIN', 'STAFF')
  async list() {
    const rows = await this.db.query.teachers.findMany({
      with: {
        user: { columns: { fullName: true, email: true, phone: true } },
        curricula: { with: { curriculum: true } },
      },
    });
    return rows
      .map((t) => ({
        id: t.id,
        userId: t.userId,
        fullName: t.user.fullName,
        email: t.user.email,
        phone: t.user.phone,
        level: t.level,
        status: t.status,
        curricula: t.curricula.map((c) => c.curriculum.name),
        curriculumIds: t.curricula.map((c) => c.curriculum.id),
      }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  @Get(':id')
  async detail(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!isStaff(user) && user.teacherId !== id) throw new ForbiddenException();
    const t = await this.db.query.teachers.findFirst({
      where: eq(teachers.id, id),
      with: {
        user: {
          columns: {
            fullName: true,
            email: true,
            phone: true,
            timezone: true,
            isActive: true,
          },
        },
        curricula: { with: { curriculum: true } },
        availability: {
          orderBy: [
            asc(availabilityWindows.weekday),
            asc(availabilityWindows.startMinute),
          ],
        },
        subscriptions: {
          where: eq(subscriptions.status, 'ACTIVE'),
          with: {
            student: {
              with: {
                user: {
                  columns: { fullName: true, timezone: true, email: true },
                },
              },
            },
            plan: true,
            curriculum: true,
            slots: true,
          },
        },
      },
    });
    if (!t) throw new NotFoundException();
    const { isActive, ...profile } = t.user;
    return {
      id: t.id,
      userId: t.userId,
      ...profile,
      /** false = this person can't sign in (turned off by staff). */
      signInActive: isActive,
      level: t.level,
      status: t.status,
      zoomLink: t.zoomLink,
      bio: t.bio,
      gender: t.gender,
      birthDate: t.birthDate,
      country: t.country,
      city: t.city,
      address: t.address,
      languages: t.languages,
      education: t.education,
      experienceYears: t.experienceYears,
      joinedOn: t.joinedOn,
      /** admins only */
      ...(user.role === 'ADMIN'
        ? {
            hourlyRateCents: t.hourlyRateCents,
            rateCurrency: t.rateCurrency,
            /** what they are actually paid: their own rate, else their level's */
            payRate: await teacherRate(this.db, t.id),
          }
        : {}),
      /** lessons cancelled by the teacher (or missed) this Cairo month, against the limit */
      cancelsThisMonth: await this.lessons.teacherCancels(
        this.db,
        t.id,
        new Date(),
      ),
      curricula: t.curricula.map((c) => ({
        id: c.curriculum.id,
        name: c.curriculum.name,
      })),
      availability: t.availability.map(
        ({ weekday, startMinute, endMinute }) => ({
          weekday,
          startMinute,
          endMinute,
        }),
      ),
      students: t.subscriptions.map((s) => ({
        subscriptionId: s.id,
        studentId: s.studentId,
        fullName: s.student.user.fullName,
        email: s.student.user.email,
        country: s.student.country,
        timezone: s.timezone,
        plan: s.plan.tier,
        planName: s.plan.name,
        curriculum: s.curriculum.name,
        startDate: s.startDate,
        lessonsPerWeek: s.lessonsPerWeek,
        slots: s.slots.map(({ weekday, startTime }) => ({
          weekday,
          startTime,
        })),
      })),
    };
  }

  @Post()
  @Roles('ADMIN', 'STAFF')
  @Area('teachers')
  async create(@CurrentUser() actor: AuthUser, @Body() body: CreateTeacherDto) {
    const email = body.email.trim().toLowerCase();
    assertCanSetPay(actor, body);
    return this.db.transaction(async (tx) => {
      const [exists] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email));
      if (exists) throw new ConflictException('This email is already used.');
      await this.assertCurricula(tx, body.curriculumIds);

      const [user] = await tx
        .insert(users)
        .values({
          email,
          fullName: body.fullName,
          phone: body.phone,
          role: 'TEACHER',
          timezone: ACADEMY_TZ,
          passwordHash: await hashPassword(body.password),
        })
        .returning();
      const [teacher] = await tx
        .insert(teachers)
        .values({
          userId: user.id,
          level: body.level,
          zoomLink: body.zoomLink,
          bio: body.bio,
          hourlyRateCents: body.hourlyRateCents ?? null,
          rateCurrency: body.rateCurrency?.toUpperCase() ?? 'EGP',
          ...profileOf(body),
          joinedOn: body.joinedOn ?? localDateOf(new Date(), ACADEMY_TZ),
        })
        .returning();
      if (body.curriculumIds.length) {
        await tx.insert(teacherCurricula).values(
          body.curriculumIds.map((curriculumId) => ({
            teacherId: teacher.id,
            curriculumId,
          })),
        );
      }
      await this.audit.record(tx, actor, {
        action: 'teacher.create',
        entityType: 'teacher',
        entityId: teacher.id,
        summary: `Added teacher ${user.fullName} (${body.level.charAt(0) + body.level.slice(1).toLowerCase()} level)`,
        after: {
          ...withoutPay(teacher),
          email,
          curriculumIds: body.curriculumIds,
        },
      });
      return { id: teacher.id, userId: user.id };
    });
  }

  @Patch(':id')
  @Roles('ADMIN', 'STAFF')
  @Area('teachers')
  async update(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateTeacherDto,
  ) {
    assertCanSetPay(actor, body);
    return this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(teachers)
        .where(eq(teachers.id, id));
      if (!before) throw new NotFoundException();
      const { fullName, phone, curriculumIds, ...rest } = body;
      const teacherFields = Object.fromEntries(
        Object.entries(rest).filter(([, v]) => v !== undefined),
      ) as Partial<typeof teachers.$inferInsert>;
      Object.assign(teacherFields, profileOf(body));
      if (teacherFields.rateCurrency)
        teacherFields.rateCurrency = teacherFields.rateCurrency.toUpperCase();
      if (Object.keys(teacherFields).length) {
        await tx.update(teachers).set(teacherFields).where(eq(teachers.id, id));
      }
      if (fullName !== undefined || phone !== undefined) {
        await tx
          .update(users)
          .set({ fullName, phone })
          .where(eq(users.id, before.userId));
      }
      if (curriculumIds) {
        await this.assertCurricula(tx, curriculumIds);
        await tx
          .delete(teacherCurricula)
          .where(eq(teacherCurricula.teacherId, id));
        if (curriculumIds.length) {
          await tx.insert(teacherCurricula).values(
            curriculumIds.map((curriculumId) => ({
              teacherId: id,
              curriculumId,
            })),
          );
        }
      }
      await this.audit.record(tx, actor, {
        action: 'teacher.update',
        entityType: 'teacher',
        entityId: id,
        summary: `Updated ${await teacherName(tx, id)}'s profile${body.hourlyRateCents !== undefined || body.rateCurrency !== undefined ? ' · pay rate changed' : ''}`,
        before: withoutPay(before),
        after: withoutPay(body),
      });
      return { id };
    });
  }

  /** Replace the weekly availability (Cairo time). */
  @Put(':id/availability')
  @Roles('ADMIN', 'STAFF')
  @Area('teachers')
  async setAvailability(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AvailabilityDto,
  ) {
    for (const w of body.windows) {
      if (w.endMinute <= w.startMinute)
        throw new BadRequestException('Each window must end after it starts.');
    }
    const sorted = [...body.windows].sort(
      (a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute,
    );
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      if (
        prev.weekday === sorted[i].weekday &&
        sorted[i].startMinute < prev.endMinute
      ) {
        throw new BadRequestException('Windows on the same day overlap.');
      }
    }
    return this.db.transaction(async (tx) => {
      const [teacher] = await tx
        .select({ id: teachers.id })
        .from(teachers)
        .where(eq(teachers.id, id));
      if (!teacher) throw new NotFoundException();
      const before = await tx
        .select()
        .from(availabilityWindows)
        .where(eq(availabilityWindows.teacherId, id));
      await tx
        .delete(availabilityWindows)
        .where(eq(availabilityWindows.teacherId, id));
      if (sorted.length) {
        await tx.insert(availabilityWindows).values(
          sorted.map(({ weekday, startMinute, endMinute }) => ({
            weekday,
            startMinute,
            endMinute,
            teacherId: id,
          })),
        );
      }
      await this.audit.record(tx, actor, {
        action: 'teacher.availability',
        entityType: 'teacher',
        entityId: id,
        summary: `Set ${await teacherName(tx, id)}'s weekly hours: ${hoursText(sorted)} (Cairo)`,
        before: before.map(({ weekday, startMinute, endMinute }) => ({
          weekday,
          startMinute,
          endMinute,
        })),
        after: sorted,
      });
      // Booked lessons are not moved; say how many now sit outside the new hours.
      const upcoming = await tx
        .select({
          startsAt: lessons.startsAt,
          durationMin: lessons.durationMin,
        })
        .from(lessons)
        .where(
          and(
            eq(lessons.teacherId, id),
            eq(lessons.status, 'SCHEDULED'),
            gte(lessons.startsAt, new Date()),
          ),
        );
      const lessonsOutside = upcoming.filter(
        (l) => !fitsAvailability(sorted, l.startsAt, l.durationMin),
      ).length;
      return { windows: sorted, lessonsOutside };
    });
  }

  private async assertCurricula(tx: Tx, ids: string[]) {
    if (!ids.length) return;
    const found = await tx
      .select({ id: curricula.id })
      .from(curricula)
      .where(inArray(curricula.id, ids));
    if (found.length !== ids.length)
      throw new BadRequestException('Unknown curriculum id.');
  }
}

/** "Sat 9:00–13:00, 17:00–23:00 · Mon 14:00–24:00" */
function hoursText(
  windows: { weekday: number; startMinute: number; endMinute: number }[],
) {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const clock = (m: number) =>
    `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
  const byDay = new Map<number, string[]>();
  for (const w of windows)
    byDay.set(w.weekday, [
      ...(byDay.get(w.weekday) ?? []),
      `${clock(w.startMinute)}–${clock(w.endMinute)}`,
    ]);
  return byDay.size
    ? [...byDay]
        .map(([d, list]) => `${days[d - 1]} ${list.join(', ')}`)
        .join(' · ')
    : 'none';
}
