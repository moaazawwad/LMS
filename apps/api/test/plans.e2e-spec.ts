/**
 * Plans set the hours a cycle gives (Basic 4, Standard 8, Premium 12), and
 * that sets the lessons a week. WIPES the database at TEST_DATABASE_URL.
 */
import {
  auth,
  type School,
  setUpSchool,
  startApp,
  type TestApp,
  testDbUrl,
} from './helpers.js';

const suite = testDbUrl ? describe : describe.skip;

interface Plan {
  id: string;
  tier: string;
  priceCents: number;
  hoursPerCycle: number;
  lessonMinutes: number;
  lessonsPerWeek: number | null;
}

suite('plans and hours (e2e)', () => {
  let t: TestApp;
  let school: School;
  let premium: Plan;
  let subscriptionId: string;

  beforeAll(async () => {
    t = await startApp();
    school = await setUpSchool(t, 1, 'pln');
    subscriptionId = (
      await t.http
        .get(`/api/students/${school.students[0].id}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body.subscriptions[0].id;
  });

  afterAll(async () => {
    await t?.app.close();
  });

  it('gives each level its hours, and the lessons a week that follow', async () => {
    premium = (
      await t.http
        .post('/api/plans')
        .set(auth(t.adminToken))
        .send({ name: 'Premium', tier: 'PREMIUM', priceCents: 2000 })
        .expect(201)
    ).body;
    expect(premium).toMatchObject({
      hoursPerCycle: 12,
      lessonMinutes: 60,
      lessonsPerWeek: 3,
    });
    const plans = (
      await t.http.get('/api/plans').set(auth(t.adminToken)).expect(200)
    ).body as Plan[];
    expect(plans.find((p) => p.tier === 'STANDARD')).toMatchObject({
      hoursPerCycle: 8,
      lessonsPerWeek: 2,
    });
  });

  it('refuses hours that do not make the same lessons every week', async () => {
    const res = await t.http
      .post('/api/plans')
      .set(auth(t.adminToken))
      .send({
        name: 'Basic',
        tier: 'BASIC',
        priceCents: 1000,
        hoursPerCycle: 6,
      })
      .expect(400);
    expect(res.body.message).toContain(
      'do not make the same number of lessons every week',
    );
    // 6 hours of 30-minute lessons is 3 a week: fine.
    const basic = (
      await t.http
        .post('/api/plans')
        .set(auth(t.adminToken))
        .send({
          name: 'Basic',
          tier: 'BASIC',
          priceCents: 1000,
          hoursPerCycle: 6,
          lessonMinutes: 30,
        })
        .expect(201)
    ).body;
    expect(basic.lessonsPerWeek).toBe(3);
    await t.http
      .patch(`/api/plans/${basic.id}`)
      .set(auth(t.adminToken))
      .send({ lessonMinutes: 50 })
      .expect(400);
    await t.http
      .patch(`/api/plans/${basic.id}`)
      .set(auth(t.adminToken))
      .send({ hoursPerCycle: 4, lessonMinutes: 60 })
      .expect(200);
  });

  it("a new subscription's plan follows its lessons a week", async () => {
    const student = (
      await t.http
        .post('/api/students')
        .set(auth(t.adminToken))
        .send({
          email: 'second.pln@test.local',
          fullName: 'Second',
          password: 'Test-password-1',
          timezone: 'America/New_York',
        })
        .expect(201)
    ).body;
    const plans = (
      await t.http.get('/api/plans').set(auth(t.adminToken)).expect(200)
    ).body as Plan[];
    const standard = plans.find((p) => p.tier === 'STANDARD')!;
    const body = {
      studentId: student.id,
      teacherId: school.teacher.id,
      curriculumId: school.curriculumId,
      startDate: new Date(Date.now() + 3 * 86_400_000)
        .toISOString()
        .slice(0, 10),
      slots: [
        { weekday: 1, startTime: '06:00' },
        { weekday: 3, startTime: '06:00' },
      ],
    };
    // A count that disagrees with the times is refused.
    const wrong = await t.http
      .post('/api/subscriptions')
      .set(auth(t.adminToken))
      .send({ ...body, lessonsPerWeek: 3 })
      .expect(400);
    expect(wrong.body.message).toContain('Give exactly 3 weekly time(s)');
    // Naming a plan that is not the one for the hours is refused.
    const notThatPlan = await t.http
      .post('/api/subscriptions')
      .set(auth(t.adminToken))
      .send({ ...body, planId: standard.id, slots: body.slots.slice(0, 1) })
      .expect(400);
    expect(notThatPlan.body.message).toContain(
      '1 lesson(s) a week is 4 hours a cycle: that is the Basic plan',
    );
    // Two hour-long lessons a week = 8 hours = Standard, without naming it.
    const created = (
      await t.http
        .post('/api/subscriptions')
        .set(auth(t.adminToken))
        .send(body)
        .expect(201)
    ).body;
    const sub = (
      await t.http
        .get(`/api/subscriptions/${created.id}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    expect(sub).toMatchObject({ planId: standard.id, lessonsPerWeek: 2 });
    expect(sub.cycles[0].invoice).toMatchObject({
      lessonsCount: 8,
      totalCents: 8 * standard.priceCents,
    });
  });

  it('adding a weekly time moves the plan up a step, and removing one moves it back', async () => {
    const before = (
      await t.http
        .get(`/api/subscriptions/${subscriptionId}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    const three = [
      { weekday: 2, startTime: '09:00' },
      { weekday: 4, startTime: '09:00' },
      { weekday: 6, startTime: '09:00' },
    ];
    // 3 a week = 12 hours = Premium; the teacher is Standard level, so it takes an override.
    const blocked = await t.http
      .patch(`/api/subscriptions/${subscriptionId}`)
      .set(auth(t.adminToken))
      .send({ slots: three })
      .expect(422);
    expect(blocked.body.violations[0]).toMatchObject({
      code: 'TEACHER_LEVEL_TOO_LOW',
    });
    expect(blocked.body.violations[0].message).toContain(
      '3 lessons a week is the Premium plan',
    );
    await t.http
      .patch(`/api/subscriptions/${subscriptionId}`)
      .set(auth(t.adminToken))
      .send({ slots: three, override: true, note: 'Upgrade to Premium' })
      .expect(200);
    const sub = (
      await t.http
        .get(`/api/subscriptions/${subscriptionId}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    expect(sub).toMatchObject({ planId: premium.id, lessonsPerWeek: 3 });
    expect(sub.slots).toHaveLength(3);

    // A plan that is not the one for 3 a week is refused.
    const wrong = await t.http
      .patch(`/api/subscriptions/${subscriptionId}`)
      .set(auth(t.adminToken))
      .send({ planId: before.planId })
      .expect(400);
    expect(wrong.body.message).toContain('that is the Premium plan');

    // Back to 2 a week: Standard again, no override needed.
    await t.http
      .patch(`/api/subscriptions/${subscriptionId}`)
      .set(auth(t.adminToken))
      .send({ slots: three.slice(0, 2) })
      .expect(200);
    expect(
      (
        await t.http
          .get(`/api/subscriptions/${subscriptionId}`)
          .set(auth(t.adminToken))
          .expect(200)
      ).body,
    ).toMatchObject({ planId: before.planId, lessonsPerWeek: 2 });
  });
});
