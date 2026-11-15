import { eq, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/db.module.js';
import { levelPayRates, teachers } from '../db/schema.js';

/*
 * A teacher's pay per hour is their own rate when one is set, otherwise the
 * rate for their level. Queries that use these must left-join levelPayRates
 * with `levelRateJoin`.
 */

export const levelRateJoin = eq(levelPayRates.level, teachers.level);

/** pay per hour in cents; null when neither the teacher nor the level has one */
export const rateCentsSql = sql<
  number | null
>`coalesce(${teachers.hourlyRateCents}, ${levelPayRates.hourlyRateCents})`.mapWith(
  (v: unknown) => (v === null ? null : Number(v)),
);

export const rateCurrencySql = sql<string>`case when ${teachers.hourlyRateCents} is not null then ${teachers.rateCurrency} else coalesce(${levelPayRates.currency}, ${teachers.rateCurrency}) end`;

/** where the rate comes from: the teacher's own, their level's, or nowhere yet */
export type RateSource = 'TEACHER' | 'LEVEL' | null;

export async function teacherRate(
  exec: Db | Tx,
  teacherId: string,
): Promise<{
  rateCents: number | null;
  currency: string;
  source: RateSource;
} | null> {
  const [row] = await exec
    .select({
      own: teachers.hourlyRateCents,
      ownCurrency: teachers.rateCurrency,
      level: levelPayRates.hourlyRateCents,
      levelCurrency: levelPayRates.currency,
    })
    .from(teachers)
    .leftJoin(levelPayRates, levelRateJoin)
    .where(eq(teachers.id, teacherId));
  if (!row) return null;
  if (row.own !== null)
    return { rateCents: row.own, currency: row.ownCurrency, source: 'TEACHER' };
  if (row.level !== null)
    return {
      rateCents: row.level,
      currency: row.levelCurrency ?? row.ownCurrency,
      source: 'LEVEL',
    };
  return { rateCents: null, currency: row.ownCurrency, source: null };
}
