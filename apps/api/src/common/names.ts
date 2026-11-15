import { eq } from 'drizzle-orm';
import type { Executor } from '../db/db.module.js';
import { teachers, users } from '../db/schema.js';

/** A teacher's full name, for log lines ("another teacher" if not found). */
export async function teacherName(exec: Executor, teacherId: string) {
  const [row] = await exec
    .select({ name: users.fullName })
    .from(teachers)
    .innerJoin(users, eq(users.id, teachers.userId))
    .where(eq(teachers.id, teacherId));
  return row?.name ?? 'another teacher';
}
