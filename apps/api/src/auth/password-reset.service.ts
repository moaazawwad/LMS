import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { and, count, eq, gt, isNull } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { DB, type Db } from '../db/db.module.js';
import { passwordResets, users } from '../db/schema.js';
import { appUrl, MailService } from '../mail/mail.service.js';
import { passwordResetEmail } from '../mail/templates.js';
import { hashPassword } from './auth.service.js';

/** How long a link works. */
export const RESET_LINK_MINUTES = 60;
/** Links one account can ask for in an hour. */
const RESETS_PER_HOUR = 3;

const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/**
 * "Forgot password": an emailed link that works once, for an hour. The
 * answer to a request is the same whether or not the email has an account.
 */
@Injectable()
export class PasswordResetService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  async request(emailInput: string, now = new Date()): Promise<void> {
    const email = emailInput.trim().toLowerCase();
    const [user] = await this.db
      .select({ id: users.id, fullName: users.fullName, email: users.email })
      .from(users)
      .where(and(eq(users.email, email), eq(users.isActive, true)));
    if (!user) return;
    const [recent] = await this.db
      .select({ n: count() })
      .from(passwordResets)
      .where(
        and(
          eq(passwordResets.userId, user.id),
          gt(passwordResets.createdAt, new Date(now.getTime() - 3_600_000)),
        ),
      );
    if ((recent?.n ?? 0) >= RESETS_PER_HOUR) return;

    const token = randomBytes(32).toString('base64url');
    await this.db.transaction(async (tx) => {
      await tx.insert(passwordResets).values({
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + RESET_LINK_MINUTES * 60_000),
        createdAt: now,
      });
      await this.mail.enqueue(
        tx,
        user.email,
        'password-reset',
        passwordResetEmail(
          user.fullName,
          `${appUrl()}/reset-password?token=${token}`,
          RESET_LINK_MINUTES,
        ),
      );
      await this.audit.record(tx, null, {
        action: 'user.password-forgot',
        entityType: 'user',
        entityId: user.id,
        summary: `${user.fullName} asked for a new-password link by email`,
      });
    });
    this.mail.sendSoon();
  }

  /** Returns the account's email, to clear sign-in pauses. */
  async reset(
    token: string,
    password: string,
    now = new Date(),
  ): Promise<string> {
    const expired = new BadRequestException(
      'This link has expired or was already used. Ask for a new one from the sign-in page.',
    );
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(passwordResets)
        .where(eq(passwordResets.tokenHash, hashToken(token)))
        .for('update');
      if (!row || row.usedAt || row.expiresAt.getTime() < now.getTime())
        throw expired;
      const [user] = await tx
        .select()
        .from(users)
        .where(eq(users.id, row.userId));
      if (!user?.isActive) throw expired;
      await tx
        .update(users)
        .set({ passwordHash: await hashPassword(password) })
        .where(eq(users.id, user.id));
      // This link and any other open one for the account stop working.
      await tx
        .update(passwordResets)
        .set({ usedAt: now })
        .where(
          and(
            eq(passwordResets.userId, user.id),
            isNull(passwordResets.usedAt),
          ),
        );
      await this.audit.record(tx, null, {
        action: 'user.password-reset-link',
        entityType: 'user',
        entityId: user.id,
        summary: `${user.fullName} set a new password from an emailed link`,
      });
      return user.email;
    });
  }
}
