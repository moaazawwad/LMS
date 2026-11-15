import { Body, Controller, Get, Inject, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { type AuthUser, CurrentUser, Roles } from '../common/auth-user.js';
import { DB, type Db, type Tx } from '../db/db.module.js';
import { academySettings } from '../db/schema.js';

const PAYMENT = 'payment_instructions';

/** How families pay (bank transfer, InstaPay, a payment link…), or null when not set. */
export async function paymentInstructions(
  exec: Db | Tx,
): Promise<string | null> {
  const [row] = await exec
    .select({ value: academySettings.value })
    .from(academySettings)
    .where(eq(academySettings.key, PAYMENT));
  return row?.value.trim() ? row.value : null;
}

class AcademySettingsDto {
  /** shown on every unpaid invoice and in the invoice email; empty to remove */
  @IsString() @MaxLength(2000) paymentInstructions: string;
}

@ApiTags('Academy settings')
@Controller('academy-settings')
export class AcademySettingsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Roles('ADMIN', 'STAFF')
  async get() {
    return { paymentInstructions: await paymentInstructions(this.db) };
  }

  @Put()
  @Roles('ADMIN')
  async set(@CurrentUser() user: AuthUser, @Body() body: AcademySettingsDto) {
    const value = body.paymentInstructions.trim();
    await this.db.transaction(async (tx) => {
      const before = await paymentInstructions(tx);
      if (value) {
        await tx
          .insert(academySettings)
          .values({ key: PAYMENT, value, updatedById: user.userId })
          .onConflictDoUpdate({
            target: academySettings.key,
            set: { value, updatedAt: new Date(), updatedById: user.userId },
          });
      } else {
        await tx
          .delete(academySettings)
          .where(eq(academySettings.key, PAYMENT));
      }
      await this.audit.record(tx, user, {
        action: 'settings.payment',
        entityType: 'settings',
        entityId: user.userId,
        summary: value
          ? 'Changed how families pay (shown on invoices)'
          : 'Removed the payment instructions from invoices',
        before: { paymentInstructions: before },
        after: { paymentInstructions: value || null },
      });
    });
    return this.get();
  }
}
