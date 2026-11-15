import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { StaffArea } from '../common/auth-user.js';
import { DB, type Db, type Executor } from '../db/db.module.js';
import { notifications, users } from '../db/schema.js';

export interface Notice {
  /** what it is about, e.g. payment.due */
  kind: string;
  title: string;
  body: string;
  /** a path in the app, e.g. /student/invoices/<id> */
  link?: string;
  /** the same key reaches a person once, however often it is raised */
  dedupKey?: string;
}

/**
 * The bell. Notices are written in the caller's transaction, so a change
 * that is rolled back tells nobody.
 */
@Injectable()
export class NotificationsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Tell these people. Returns the user ids that were actually told (a notice
   * with a dedupKey someone already has is skipped for them).
   */
  async notify(
    exec: Executor,
    userIds: string | string[],
    n: Notice,
  ): Promise<string[]> {
    const ids = [...new Set(Array.isArray(userIds) ? userIds : [userIds])];
    if (!ids.length) return [];
    const rows = await exec
      .insert(notifications)
      .values(
        ids.map((userId) => ({
          userId,
          kind: n.kind,
          title: n.title,
          body: n.body,
          link: n.link ?? null,
          dedupKey: n.dedupKey ?? null,
        })),
      )
      .onConflictDoNothing()
      .returning({ userId: notifications.userId });
    return rows.map((r) => r.userId);
  }

  /** Tell the admins, and the staff who have this area (or every area). */
  async notifyStaff(exec: Executor, area: StaffArea, n: Notice) {
    const staff = await exec
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.isActive, true),
          or(
            eq(users.role, 'ADMIN'),
            and(
              eq(users.role, 'STAFF'),
              or(
                isNull(users.staffAreas),
                sql`${area} = any(${users.staffAreas})`,
              ),
            ),
          ),
        ),
      );
    return this.notify(
      exec,
      staff.map((s) => s.id),
      n,
    );
  }

  /** A person's latest notices and how many they have not read. */
  async list(userId: string, limit = 30) {
    const items = await this.db
      .select({
        id: notifications.id,
        kind: notifications.kind,
        title: notifications.title,
        body: notifications.body,
        link: notifications.link,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
    return { unread: await this.unread(userId), items };
  }

  async unread(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(notifications)
      .where(
        and(eq(notifications.userId, userId), isNull(notifications.readAt)),
      );
    return row?.n ?? 0;
  }

  /** Mark some of a person's notices read, or all of them. */
  async markRead(userId: string, ids?: string[]): Promise<number> {
    if (ids && !ids.length) return 0;
    const rows = await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
          ids ? inArray(notifications.id, ids) : undefined,
        ),
      )
      .returning({ id: notifications.id });
    return rows.length;
  }
}
