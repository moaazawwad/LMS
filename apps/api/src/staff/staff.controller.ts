import { ApiTags } from '@nestjs/swagger';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { and, asc, count, eq, inArray, ne } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AuthService, hashPassword } from '../auth/auth.service.js';
import {
  type AuthUser,
  CurrentUser,
  Roles,
  STAFF_AREAS,
  type StaffArea,
} from '../common/auth-user.js';
import { DB, type Db, type Tx } from '../db/db.module.js';
import { users } from '../db/schema.js';
import { ACADEMY_TZ } from '../rules/schedule.js';

type StaffRole = 'ADMIN' | 'STAFF';

class CreateStaffDto {
  @IsEmail() email: string;
  @IsString() @MinLength(2) fullName: string;
  @IsString() @MinLength(8) password: string;
  @IsIn(['ADMIN', 'STAFF']) role: StaffRole;
  /** STAFF: what they work on; leave out for everything */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(STAFF_AREAS, { each: true })
  areas?: StaffArea[];
}

class UpdateStaffDto {
  @IsOptional() @IsString() @MinLength(2) fullName?: string;
  @IsOptional() @IsIn(['ADMIN', 'STAFF']) role?: StaffRole;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(STAFF_AREAS, { each: true })
  areas?: StaffArea[];
}

/** Stored as given, in a fixed order; every area ticked is the same as no limit. */
function storedAreas(
  role: StaffRole,
  areas: StaffArea[] | undefined,
): string[] | null {
  if (role !== 'STAFF' || !areas || areas.length === STAFF_AREAS.length)
    return null;
  return STAFF_AREAS.filter((a) => areas.includes(a));
}

const areasText = (a: string[] | null) =>
  a ? (a.length ? a.join(', ') : 'nothing') : 'everything';

class ResetPasswordDto {
  @IsString() @MinLength(8) newPassword: string;
}

class SetActiveDto {
  @IsBoolean() isActive: boolean;
}

const staffColumns = {
  id: users.id,
  fullName: users.fullName,
  email: users.email,
  role: users.role,
  isActive: users.isActive,
  /** null = every area */
  areas: users.staffAreas,
  createdAt: users.createdAt,
};

/**
 * Staff & roles. Two fixed roles in v1:
 * - ADMIN: everything, including staff, plans and voiding invoices
 * - STAFF: day-to-day work on students, teachers, lessons and payments
 */
@ApiTags('Staff & accounts')
@Controller()
export class StaffController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  @Get('staff')
  @Roles('ADMIN')
  list() {
    return this.db
      .select(staffColumns)
      .from(users)
      .where(inArray(users.role, ['ADMIN', 'STAFF']))
      .orderBy(asc(users.fullName));
  }

  @Post('staff')
  @Roles('ADMIN')
  async create(@CurrentUser() actor: AuthUser, @Body() body: CreateStaffDto) {
    const email = body.email.trim().toLowerCase();
    return this.db.transaction(async (tx) => {
      const [exists] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email));
      if (exists) throw new ConflictException('This email is already used.');
      const [row] = await tx
        .insert(users)
        .values({
          email,
          fullName: body.fullName,
          role: body.role,
          timezone: ACADEMY_TZ,
          passwordHash: await hashPassword(body.password),
          staffAreas: storedAreas(body.role, body.areas),
        })
        .returning(staffColumns);
      await this.audit.record(tx, actor, {
        action: 'staff.create',
        entityType: 'user',
        entityId: row.id,
        summary: `Added ${body.role.toLowerCase()} ${row.fullName}${row.role === 'STAFF' ? ` · works on ${areasText(row.areas)}` : ''}`,
        after: row,
      });
      return row;
    });
  }

  @Patch('staff/:id')
  @Roles('ADMIN')
  async update(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateStaffDto,
  ) {
    const row = await this.db.transaction(async (tx) => {
      const [before] = await tx
        .select(staffColumns)
        .from(users)
        .where(eq(users.id, id))
        .for('update');
      if (!before || (before.role !== 'ADMIN' && before.role !== 'STAFF'))
        throw new NotFoundException();
      const losesAdmin =
        before.role === 'ADMIN' &&
        (body.role === 'STAFF' || body.isActive === false);
      if (losesAdmin) {
        if (id === actor.userId)
          throw new BadRequestException(
            'You cannot remove your own admin access.',
          );
        await this.assertAnotherAdmin(tx, id);
      }
      const { areas, ...rest } = body;
      const role = body.role ?? (before.role as StaffRole);
      // Areas apply to staff only; making someone an admin clears them.
      const staffAreas =
        role === 'ADMIN'
          ? null
          : areas !== undefined
            ? storedAreas(role, areas)
            : before.areas;
      const [row] = await tx
        .update(users)
        .set({ ...rest, staffAreas })
        .where(eq(users.id, id))
        .returning(staffColumns);
      const areasChanged =
        (before.areas ?? []).join() !== (row.areas ?? []).join() ||
        !before.areas !== !row.areas;
      await this.audit.record(tx, actor, {
        action: 'staff.update',
        entityType: 'user',
        entityId: id,
        summary: `Updated ${row.fullName}: ${before.role}${before.isActive ? '' : ' (inactive)'} → ${row.role}${row.isActive ? '' : ' (inactive)'}${areasChanged && row.role === 'STAFF' ? ` · works on ${areasText(row.areas)}` : ''}`,
        before,
        after: row,
      });
      return row;
    });
    this.auth.forget(id);
    return row;
  }

  /**
   * Set a new password for someone else. Staff can do it for teachers and
   * students; only admins can do it for staff and other admins.
   */
  @Post('users/:id/password')
  @HttpCode(204)
  @Roles('ADMIN', 'STAFF')
  async resetPassword(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ResetPasswordDto,
  ) {
    await this.db.transaction(async (tx) => {
      const [target] = await tx
        .select({ role: users.role, fullName: users.fullName })
        .from(users)
        .where(eq(users.id, id));
      if (!target) throw new NotFoundException();
      if (
        (target.role === 'ADMIN' || target.role === 'STAFF') &&
        actor.role !== 'ADMIN'
      )
        throw new ForbiddenException();
      await tx
        .update(users)
        .set({ passwordHash: await hashPassword(body.newPassword) })
        .where(eq(users.id, id));
      await this.audit.record(tx, actor, {
        action: 'user.password-reset',
        entityType: 'user',
        entityId: id,
        summary: `Reset the password of ${target.fullName}`,
      });
    });
  }

  /** Turn any sign-in on or off (a teacher or student who left, for example). */
  @Post('users/:id/active')
  @HttpCode(200)
  @Roles('ADMIN', 'STAFF')
  async setActive(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SetActiveDto,
  ) {
    const result = await this.db.transaction(async (tx) => {
      const [target] = await tx
        .select({
          role: users.role,
          fullName: users.fullName,
          isActive: users.isActive,
        })
        .from(users)
        .where(eq(users.id, id));
      if (!target) throw new NotFoundException();
      if (
        (target.role === 'ADMIN' || target.role === 'STAFF') &&
        actor.role !== 'ADMIN'
      )
        throw new ForbiddenException();
      if (id === actor.userId && !body.isActive)
        throw new BadRequestException('You cannot turn off your own sign-in.');
      if (target.role === 'ADMIN' && !body.isActive)
        await this.assertAnotherAdmin(tx, id);
      await tx
        .update(users)
        .set({ isActive: body.isActive })
        .where(eq(users.id, id));
      await this.audit.record(tx, actor, {
        action: body.isActive ? 'user.activate' : 'user.deactivate',
        entityType: 'user',
        entityId: id,
        summary: `${body.isActive ? 'Turned on' : 'Turned off'} sign-in for ${target.fullName}`,
        before: { isActive: target.isActive },
        after: { isActive: body.isActive },
      });
      return { id, isActive: body.isActive };
    });
    this.auth.forget(id);
    return result;
  }

  private async assertAnotherAdmin(tx: Tx, exceptId: string) {
    const [{ admins }] = await tx
      .select({ admins: count() })
      .from(users)
      .where(
        and(
          eq(users.role, 'ADMIN'),
          eq(users.isActive, true),
          ne(users.id, exceptId),
        ),
      );
    if (admins === 0)
      throw new BadRequestException(
        'There must always be at least one active admin.',
      );
  }
}
