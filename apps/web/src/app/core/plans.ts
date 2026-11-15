import type { Plan } from './models';

/** Hours of lessons a 28-day cycle gives at this many lessons a week. */
export function hoursPerCycle(lessonsPerWeek: number, lessonMinutes: number): number {
  return (lessonsPerWeek * 4 * lessonMinutes) / 60;
}

/**
 * The plan a number of lessons a week falls under (same rule as the API):
 * the biggest active plan whose hours the lessons reach; below the smallest
 * plan's hours, the smallest plan.
 */
export function planForLessons(plans: Plan[], lessonsPerWeek: number): Plan | null {
  const active = plans.filter((p) => p.isActive).sort((a, b) => a.hoursPerCycle - b.hoursPerCycle);
  if (!active.length || lessonsPerWeek < 1) return null;
  let pick = active[0];
  for (const p of active)
    if (hoursPerCycle(lessonsPerWeek, p.lessonMinutes) >= p.hoursPerCycle) pick = p;
  return pick;
}

/** "2 lessons a week · 8 hours a cycle → Standard · $15.00 a lesson · $120.00 a cycle" pieces. */
export function planSummary(plans: Plan[], lessonsPerWeek: number) {
  const plan = planForLessons(plans, lessonsPerWeek);
  if (!plan) return null;
  const lessons = lessonsPerWeek * 4;
  return {
    plan,
    hours: hoursPerCycle(lessonsPerWeek, plan.lessonMinutes),
    lessons,
    cycleCents: lessons * plan.priceCents,
  };
}
