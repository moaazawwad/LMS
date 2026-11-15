import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { type AuthUser, CurrentUser, Roles } from '../common/auth-user.js';
import { DB, type Db, type Tx } from '../db/db.module.js';
import { levelPayRates, teachers, tierEnum } from '../db/schema.js';

type Tier = (typeof tierEnum.enumValues)[number];
const LEVELS: Tier[] = ['PREMIUM', 'STANDARD', 'BASIC'];
const label = (l: Tier) => l.charAt(0) + l.slice(1).toLowerCase();

class LevelRateDto {
  @IsIn(tierEnum.enumValues) level: Tier;
  /** pay per hour in cents; null removes the level's rate */
  @IsOptional() @IsInt() @Min(0) @Max(10_000_000) hourlyRateCents:
    number | null;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
}

class LevelRatesDto {
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => LevelRateDto)
  rates: LevelRateDto[];
}

async function readRates(exec: Db | Tx) {
  const rows = await exec.select().from(levelPayRates);
  const counts = await exec
    .select({ level: teachers.level, own: teachers.hourlyRateCents })
    .from(teachers)
    .where(eq(teachers.status, 'ACTIVE'));
  return LEVELS.map((level) => {
    const r = rows.find((x) => x.level === level);
    const mine = counts.filter((c) => c.level === level);
    return {
      level,
      hourlyRateCents: r?.hourlyRateCents ?? null,
      currency: r?.currency ?? 'EGP',
      /** active teachers at this level */
      teachers: mine.length,
      /** of them, paid their own rate instead of this one */
      ownRate: mine.filter((c) => c.own !== null).length,
    };
  });
}

/**
 * Pay per hour by teacher level. A teacher with their own rate keeps it;
 * everyone else is paid their level's rate. Admin only, like all pay.
 */
@ApiTags('Teacher pay')
@Controller('level-pay-rates')
@Roles('ADMIN')
export class LevelRatesController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  @Get()
  get() {
    return readRates(this.db);
  }

  @Put()
  async set(@CurrentUser() user: AuthUser, @Body() body: LevelRatesDto) {
    const levels = body.rates.map((r) => r.level);
    if (new Set(levels).size !== levels.length)
      throw new BadRequestException('Each level only once.');
    await this.db.transaction(async (tx) => {
      const before = await readRates(tx);
      const changes: string[] = [];
      for (const r of body.rates) {
        const old = before.find((b) => b.level === r.level)!;
        const currency = (r.currency ?? old.currency).toUpperCase();
        if (
          old.hourlyRateCents === (r.hourlyRateCents ?? null) &&
          (r.hourlyRateCents === null || old.currency === currency)
        )
          continue;
        if (r.hourlyRateCents === null || r.hourlyRateCents === undefined) {
          await tx
            .delete(levelPayRates)
            .where(eq(levelPayRates.level, r.level));
          changes.push(`${label(r.level)} removed`);
        } else {
          const set = {
            hourlyRateCents: r.hourlyRateCents,
            currency,
            updatedAt: new Date(),
            updatedById: user.userId,
          };
          await tx
            .insert(levelPayRates)
            .values({ level: r.level, ...set })
            .onConflictDoUpdate({ target: levelPayRates.level, set });
          changes.push(label(r.level));
        }
      }
      if (!changes.length) return;
      // The log says which levels changed, not the amounts (like teacher rates).
      await this.audit.record(tx, user, {
        action: 'pay.level-rates',
        entityType: 'settings',
        entityId: user.userId,
        summary: `Changed pay per hour by level: ${changes.join(', ')}`,
      });
    });
    return readRates(this.db);
  }
}
