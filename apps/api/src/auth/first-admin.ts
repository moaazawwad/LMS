import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { count, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { DB, type Db } from '../db/db.module.js';
import { users } from '../db/schema.js';
import { hashPassword } from './auth.service.js';

/** Longer than the usual 8: this account can do everything. */
export const FIRST_ADMIN_MIN_PASSWORD = 12;

export type FirstAdminSettings =
  | { email: string; fullName: string; password: string }
  | { problem: string }
  | null;

/**
 * The first admin of a new deployment, from ADMIN_EMAIL, ADMIN_PASSWORD and
 * (optionally) ADMIN_NAME. null when they are not set.
 */
export function firstAdminFromEnv(
  env: Record<string, string | undefined>,
): FirstAdminSettings {
  const email = env.ADMIN_EMAIL?.trim().toLowerCase() ?? '';
  const password = env.ADMIN_PASSWORD ?? '';
  if (!email && !password) return null;
  if (!email || !password)
    return {
      problem:
        'Set both ADMIN_EMAIL and ADMIN_PASSWORD to create the first admin.',
    };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return { problem: 'ADMIN_EMAIL is not an email address.' };
  if (password.length < FIRST_ADMIN_MIN_PASSWORD) {
    return {
      problem: `ADMIN_PASSWORD must be at least ${FIRST_ADMIN_MIN_PASSWORD} characters.`,
    };
  }
  return { email, password, fullName: env.ADMIN_NAME?.trim() || 'Admin' };
}

/**
 * A new deployment has no accounts. When ADMIN_EMAIL and ADMIN_PASSWORD are
 * set and there is no admin yet, this creates one at startup. Once any admin
 * exists it does nothing, so the variables are harmless afterwards (but the
 * password should still be removed from the settings).
 */
@Injectable()
export class FirstAdminService implements OnApplicationBootstrap {
  private readonly log = new Logger('FirstAdmin');

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async onApplicationBootstrap() {
    let result: string;
    try {
      result = await this.ensure(process.env);
    } catch (err) {
      // Never stop the server over this; say what happened.
      this.log.error(
        `Could not create the first admin: ${(err as Error).message}`,
      );
      return;
    }
    if (result === 'created')
      this.log.log(
        'Created the first admin account. Remove ADMIN_PASSWORD from the settings now.',
      );
    else if (result === 'exists')
      this.log.warn(
        'ADMIN_PASSWORD is still set but an admin already exists, so nothing was created. Remove it from the settings.',
      );
    else if (result !== 'not-set') this.log.error(result);
  }

  /** 'created', 'exists', 'not-set', or what is wrong. */
  async ensure(env: Record<string, string | undefined>): Promise<string> {
    const settings = firstAdminFromEnv(env);
    if (!settings) return 'not-set';
    if ('problem' in settings) return settings.problem;
    const passwordHash = await hashPassword(settings.password);
    try {
      return await this.db.transaction(async (tx) => {
        // Only ever for a deployment with no admin at all.
        const [admins] = await tx
          .select({ n: count() })
          .from(users)
          .where(eq(users.role, 'ADMIN'));
        if ((admins?.n ?? 0) > 0) return 'exists';
        const [user] = await tx
          .insert(users)
          .values({
            email: settings.email,
            fullName: settings.fullName,
            role: 'ADMIN',
            passwordHash,
          })
          .returning({ id: users.id });
        await this.audit.record(tx, null, {
          action: 'user.first-admin',
          entityType: 'user',
          entityId: user.id,
          summary: `First admin created from the server settings: ${settings.email}`,
        });
        return 'created';
      });
    } catch (err) {
      // That email is taken: another account has it, or a second copy of the server got there first.
      if (
        (err as { cause?: { code?: string }; code?: string }).cause?.code ===
          '23505' ||
        (err as { code?: string }).code === '23505'
      ) {
        return 'An account with ADMIN_EMAIL already exists. Use another email, or sign in with that account.';
      }
      throw err;
    }
  }
}
