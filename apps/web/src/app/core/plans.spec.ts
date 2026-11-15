import type { Plan } from './models';
import { planForLessons, planSummary } from './plans';

const plan = (name: string, hoursPerCycle: number, priceCents: number, isActive = true): Plan => ({
  id: name,
  name,
  tier: 'BASIC',
  priceCents,
  currency: 'USD',
  cancelQuota: null,
  rescheduleQuota: null,
  lessonMinutes: 60,
  hoursPerCycle,
  lessonsPerWeek: hoursPerCycle / 4,
  isActive,
});

describe('planForLessons', () => {
  const plans = [plan('Premium', 12, 2000), plan('Basic', 4, 1000), plan('Standard', 8, 1500)];

  it('steps up as the hours reach each plan', () => {
    expect([1, 2, 3, 5].map((n) => planForLessons(plans, n)?.name)).toEqual([
      'Basic',
      'Standard',
      'Premium',
      'Premium',
    ]);
  });

  it('skips inactive plans and needs at least one lesson', () => {
    const some = [...plans.slice(0, 2), plan('Standard', 8, 1500, false)];
    expect(planForLessons(some, 2)?.name).toBe('Basic');
    expect(planForLessons(plans, 0)).toBeNull();
  });

  it('prices the cycle at the plan price per lesson', () => {
    expect(planSummary(plans, 2)).toMatchObject({ hours: 8, lessons: 8, cycleCents: 12000 });
  });
});
