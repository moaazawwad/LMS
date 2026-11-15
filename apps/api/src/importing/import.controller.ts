import { ApiTags } from '@nestjs/swagger';
import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { inArray } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { hashPassword } from '../auth/auth.service.js';
import { type AuthUser, CurrentUser, Roles } from '../common/auth-user.js';
import { DB, type Db } from '../db/db.module.js';
import {
  curricula,
  students,
  teacherCurricula,
  teachers,
  users,
} from '../db/schema.js';
import {
  checkStudentRows,
  checkTeacherRows,
  MAX_IMPORT_ROWS,
  readablePassword,
  type RowCheck,
} from '../rules/import-rows.js';
import { ACADEMY_TZ } from '../rules/schedule.js';

/** Every cell arrives as text, as it was in the file. */
class PersonRowDto {
  @IsOptional() @IsString() @MaxLength(200) fullName?: string;
  @IsOptional() @IsString() @MaxLength(200) email?: string;
  @IsOptional() @IsString() @MaxLength(50) phone?: string;
  @IsOptional() @IsString() @MaxLength(100) password?: string;
  @IsOptional() @IsString() @MaxLength(100) timezone?: string;
  @IsOptional() @IsString() @MaxLength(30) level?: string;
  @IsOptional() @IsString() @MaxLength(500) curricula?: string;
  @IsOptional() @IsString() @MaxLength(30) hourlyRate?: string;
  @IsOptional() @IsString() @MaxLength(300) zoomLink?: string;
}

class ImportDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_IMPORT_ROWS)
  @ValidateNested({ each: true })
  @Type(() => PersonRowDto)
  rows: PersonRowDto[];
  /** false (default): only check. true: create everyone, or no one if any row has a problem. */
  @IsOptional() @IsBoolean() commit?: boolean;
}

interface ImportResult {
  rows: { row: number; fullName: string; email: string; problems: string[] }[];
  /** null when nothing was created (a check, or a file with problems) */
  created:
    | {
        fullName: string;
        email: string;
        password: string;
        generated: boolean;
      }[]
    | null;
}

/**
 * Add many students or teachers from a spreadsheet. Admin only. Accounts
 * only: subscriptions are booked one by one afterwards. Rows are checked
 * first; creating is all or nothing.
 */
@ApiTags('Import')
@Controller('import')
@Roles('ADMIN')
export class ImportController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  @Post('students')
  @HttpCode(200)
  async students(
    @CurrentUser() actor: AuthUser,
    @Body() body: ImportDto,
  ): Promise<ImportResult> {
    const checks = checkStudentRows(body.rows);
    await this.markTaken(checks);
    if (!body.commit || checks.some((c) => c.problems.length))
      return this.result(checks, null);

    const people = await this.withPasswords(checks.map((c) => c.value!));
    await this.db.transaction(async (tx) => {
      for (const p of people) {
        const [user] = await tx
          .insert(users)
          .values({
            email: p.email,
            fullName: p.fullName,
            phone: p.phone,
            role: 'STUDENT',
            timezone: p.timezone,
            passwordHash: p.hash,
          })
          .returning({ id: users.id });
        await tx.insert(students).values({ userId: user.id });
      }
      await this.audit.record(tx, actor, {
        action: 'student.import',
        entityType: 'import',
        entityId: actor.userId,
        summary: `Imported ${people.length} student${people.length === 1 ? '' : 's'} from a spreadsheet: ${this.names(people)}`,
        after: { emails: people.map((p) => p.email) },
      });
    });
    return this.result(checks, people);
  }

  @Post('teachers')
  @HttpCode(200)
  async teachers(
    @CurrentUser() actor: AuthUser,
    @Body() body: ImportDto,
  ): Promise<ImportResult> {
    const known = await this.db
      .select({ id: curricula.id, name: curricula.name })
      .from(curricula);
    const checks = checkTeacherRows(
      body.rows,
      known.map((c) => c.name),
    );
    await this.markTaken(checks);
    if (!body.commit || checks.some((c) => c.problems.length))
      return this.result(checks, null);

    const idOf = new Map(known.map((c) => [c.name, c.id]));
    const people = await this.withPasswords(checks.map((c) => c.value!));
    await this.db.transaction(async (tx) => {
      for (const p of people) {
        const [user] = await tx
          .insert(users)
          .values({
            email: p.email,
            fullName: p.fullName,
            phone: p.phone,
            role: 'TEACHER',
            timezone: ACADEMY_TZ,
            passwordHash: p.hash,
          })
          .returning({ id: users.id });
        const [teacher] = await tx
          .insert(teachers)
          .values({
            userId: user.id,
            level: p.level,
            zoomLink: p.zoomLink,
            hourlyRateCents: p.hourlyRateCents,
          })
          .returning({ id: teachers.id });
        if (p.curriculumNames.length) {
          await tx.insert(teacherCurricula).values(
            p.curriculumNames.map((n) => ({
              teacherId: teacher.id,
              curriculumId: idOf.get(n)!,
            })),
          );
        }
      }
      await this.audit.record(tx, actor, {
        action: 'teacher.import',
        entityType: 'import',
        entityId: actor.userId,
        // Rates stay out of the log, as for one teacher.
        summary: `Imported ${people.length} teacher${people.length === 1 ? '' : 's'} from a spreadsheet: ${this.names(people)}`,
        after: { emails: people.map((p) => p.email) },
      });
    });
    return this.result(checks, people);
  }

  /** Emails that already have an account. */
  private async markTaken<T>(checks: RowCheck<T>[]) {
    const emails = checks.map((c) => c.email).filter(Boolean);
    if (!emails.length) return;
    const taken = new Set(
      (
        await this.db
          .select({ email: users.email })
          .from(users)
          .where(inArray(users.email, emails))
      ).map((u) => u.email),
    );
    for (const c of checks) {
      if (taken.has(c.email)) {
        c.problems.push('Someone already has an account with this email.');
        c.value = null;
      }
    }
  }

  private async withPasswords<T extends { password: string | null }>(
    people: T[],
  ) {
    return Promise.all(
      people.map(async (p) => {
        const password = p.password ?? readablePassword();
        return {
          ...p,
          password,
          generated: !p.password,
          hash: await hashPassword(password),
        };
      }),
    );
  }

  private names(people: { fullName: string }[]) {
    const shown = people.slice(0, 5).map((p) => p.fullName);
    return people.length > 5
      ? `${shown.join(', ')} and ${people.length - 5} more`
      : shown.join(', ');
  }

  private result<T>(
    checks: RowCheck<T>[],
    created:
      | {
          fullName: string;
          email: string;
          password: string;
          generated: boolean;
        }[]
      | null,
  ): ImportResult {
    return {
      rows: checks.map(({ row, fullName, email, problems }) => ({
        row,
        fullName,
        email,
        problems,
      })),
      created:
        created &&
        created.map(({ fullName, email, password, generated }) => ({
          fullName,
          email,
          password,
          generated,
        })),
    };
  }
}
