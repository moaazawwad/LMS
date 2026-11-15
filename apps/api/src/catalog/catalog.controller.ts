import { ApiTags } from '@nestjs/swagger';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { PartialType } from '@nestjs/mapped-types';
import { asc, eq } from 'drizzle-orm';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { AuditService } from '../audit/audit.service.js';
import {
  Area,
  type AuthUser,
  CurrentUser,
  Roles,
} from '../common/auth-user.js';
import { DB, type Db } from '../db/db.module.js';
import { curricula, plans, tierEnum, type Tier } from '../db/schema.js';
import {
  DEFAULT_HOURS_PER_CYCLE,
  lessonsPerWeekFor,
} from '../rules/billing.js';

class CurriculumDto {
  @IsString() @MinLength(1) name: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class UpdateCurriculumDto extends PartialType(CurriculumDto) {}

class PlanDto {
  @IsString() @MinLength(1) name: string;
  @IsIn(tierEnum.enumValues) tier: Tier;
  @IsInt() @Min(0) priceCents: number;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  /** null or missing = unlimited */
  @IsOptional() @IsInt() @Min(0) cancelQuota?: number | null;
  @IsOptional() @IsInt() @Min(0) rescheduleQuota?: number | null;
  @IsOptional() @IsInt() @Min(15) @Max(180) lessonMinutes?: number;
  /** hours of lessons a 28-day cycle gives; default by level: Basic 4, Standard 8, Premium 12 */
  @IsOptional() @IsInt() @Min(1) @Max(56) hoursPerCycle?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

/** The hours must spread evenly over the 4 weeks of a cycle. */
function checkHours(plan: { hoursPerCycle: number; lessonMinutes: number }) {
  if (lessonsPerWeekFor(plan) === null) {
    throw new BadRequestException(
      `${plan.hoursPerCycle} hours of ${plan.lessonMinutes}-minute lessons do not make the same number of lessons every week of a 4-week cycle.`,
    );
  }
}

const withWeekly = <T extends { hoursPerCycle: number; lessonMinutes: number }>(
  p: T,
) => ({ ...p, lessonsPerWeek: lessonsPerWeekFor(p) });
class UpdatePlanDto extends PartialType(PlanDto) {}

@ApiTags('Curricula & plans')
@Controller()
export class CatalogController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  // Everyone signed in can read the catalogue; only staff change it.

  @Get('curricula')
  listCurricula() {
    return this.db.select().from(curricula).orderBy(asc(curricula.name));
  }

  @Post('curricula')
  @Roles('ADMIN', 'STAFF')
  @Area('catalog')
  async createCurriculum(
    @CurrentUser() user: AuthUser,
    @Body() body: CurriculumDto,
  ) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(curricula).values(body).returning();
      await this.audit.record(tx, user, {
        action: 'curriculum.create',
        entityType: 'curriculum',
        entityId: row.id,
        summary: `Added curriculum ${row.name}`,
        after: row,
      });
      return row;
    });
  }

  @Patch('curricula/:id')
  @Roles('ADMIN', 'STAFF')
  @Area('catalog')
  async updateCurriculum(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateCurriculumDto,
  ) {
    return this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(curricula)
        .where(eq(curricula.id, id));
      if (!before) throw new NotFoundException();
      const [row] = await tx
        .update(curricula)
        .set(body)
        .where(eq(curricula.id, id))
        .returning();
      await this.audit.record(tx, user, {
        action: 'curriculum.update',
        entityType: 'curriculum',
        entityId: id,
        summary: `Updated curriculum ${row.name}`,
        before,
        after: row,
      });
      return row;
    });
  }

  @Get('plans')
  async listPlans() {
    return (
      await this.db.select().from(plans).orderBy(asc(plans.priceCents))
    ).map(withWeekly);
  }

  @Post('plans')
  @Roles('ADMIN')
  async createPlan(@CurrentUser() user: AuthUser, @Body() body: PlanDto) {
    return this.db.transaction(async (tx) => {
      const values = {
        name: body.name,
        tier: body.tier,
        priceCents: body.priceCents,
        currency: body.currency,
        cancelQuota: body.cancelQuota ?? null,
        rescheduleQuota: body.rescheduleQuota ?? null,
        lessonMinutes: body.lessonMinutes ?? 60,
        hoursPerCycle: body.hoursPerCycle ?? DEFAULT_HOURS_PER_CYCLE[body.tier],
        isActive: body.isActive ?? true,
      };
      checkHours(values);
      const [row] = await tx.insert(plans).values(values).returning();
      await this.audit.record(tx, user, {
        action: 'plan.create',
        entityType: 'plan',
        entityId: row.id,
        summary: `Added plan ${row.name}`,
        after: row,
      });
      return withWeekly(row);
    });
  }

  @Patch('plans/:id')
  @Roles('ADMIN')
  async updatePlan(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdatePlanDto,
  ) {
    return this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(plans).where(eq(plans.id, id));
      if (!before) throw new NotFoundException();
      // Booked subscriptions keep their weekly lessons until their plan or times change.
      checkHours({
        hoursPerCycle: body.hoursPerCycle ?? before.hoursPerCycle,
        lessonMinutes: body.lessonMinutes ?? before.lessonMinutes,
      });
      const [row] = await tx
        .update(plans)
        .set(body)
        .where(eq(plans.id, id))
        .returning();
      await this.audit.record(tx, user, {
        action: 'plan.update',
        entityType: 'plan',
        entityId: id,
        summary: `Updated plan ${row.name}`,
        before,
        after: row,
      });
      return withWeekly(row);
    });
  }
}
