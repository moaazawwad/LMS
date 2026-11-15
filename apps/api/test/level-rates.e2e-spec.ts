/**
 * Pay per hour by teacher level, and a teacher's own rate on top of it.
 * WIPES the database at TEST_DATABASE_URL.
 */
import { DateTime } from 'luxon';
import pg from 'pg';
import {
  auth,
  PASSWORD,
  type School,
  setUpSchool,
  startApp,
  type TestApp,
  testDbUrl,
} from './helpers.js';

const suite = testDbUrl ? describe : describe.skip;
const CAIRO = 'Africa/Cairo';

suite('pay by teacher level (e2e)', () => {
  let t: TestApp;
  let school: School;
  let pool: pg.Pool;
  let staffToken: string;
  const month = DateTime.now().setZone(CAIRO).minus({ months: 1 });
  const from = month.startOf('month').toISODate()!;
  const to = month.endOf('month').toISODate()!;

  const setRates = (rates: object[], token = t.adminToken) =>
    t.http.put('/api/level-pay-rates').set(auth(token)).send({ rates });
  const payRow = async () =>
    (
      await t.http
        .get(`/api/stats/teacher-lessons?from=${from}&to=${to}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body.find(
      (r: { teacherId: string }) => r.teacherId === school.teacher.id,
    );
  const payRate = async () =>
    (
      await t.http
        .get(`/api/teachers/${school.teacher.id}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body.payRate;

  beforeAll(async () => {
    t = await startApp();
    school = await setUpSchool(t, 1, 'lvl');
    pool = new pg.Pool({ connectionString: testDbUrl });
    await t.http
      .post('/api/staff')
      .set(auth(t.adminToken))
      .send({
        email: 'staff.lvl@test.local',
        fullName: 'Staff Level',
        password: PASSWORD,
        role: 'STAFF',
      })
      .expect(201);
    staffToken = await t.login('staff.lvl@test.local');
    // Two held lessons last month: two paid hours.
    const base = month.set({ day: 10, hour: 15 });
    for (const [i, id] of school.students[0].lessonIds.slice(0, 2).entries())
      await pool.query(
        `update lessons set starts_at = $2, closed_at = $2::timestamptz + interval '65 minutes',
           status = 'COMPLETED', attendance = 'BOTH' where id = $1`,
        [id, base.plus({ days: i * 2 }).toJSDate()],
      );
  });

  afterAll(async () => {
    await pool?.end();
    await t?.app.close();
  });

  it('is for admins only', async () => {
    await t.http.get('/api/level-pay-rates').set(auth(staffToken)).expect(403);
    await setRates(
      [{ level: 'BASIC', hourlyRateCents: 100 }],
      staffToken,
    ).expect(403);
  });

  it('starts with no rates, so no pay', async () => {
    const res = await t.http
      .get('/api/level-pay-rates')
      .set(auth(t.adminToken))
      .expect(200);
    expect(res.body.map((r: { level: string }) => r.level)).toEqual([
      'PREMIUM',
      'STANDARD',
      'BASIC',
    ]);
    expect(
      res.body.find((r: { level: string }) => r.level === 'STANDARD'),
    ).toMatchObject({ hourlyRateCents: null, teachers: 1, ownRate: 0 });
    expect(await payRow()).toMatchObject({ rateCents: null, payCents: null });
    expect(await payRate()).toEqual({
      rateCents: null,
      currency: 'EGP',
      source: null,
    });
    const blocked = await t.http
      .post('/api/payouts')
      .set(auth(t.adminToken))
      .send({ teacherId: school.teacher.id, month: month.toFormat('yyyy-MM') })
      .expect(400);
    expect(blocked.body.message).toContain('for their level');
  });

  it("pays a teacher without their own rate their level's rate", async () => {
    const res = await setRates([
      { level: 'PREMIUM', hourlyRateCents: 30000, currency: 'egp' },
      { level: 'STANDARD', hourlyRateCents: 20000 },
      { level: 'BASIC', hourlyRateCents: 15000 },
    ]).expect(200);
    expect(res.body[0]).toMatchObject({
      level: 'PREMIUM',
      hourlyRateCents: 30000,
      currency: 'EGP',
    });
    expect(await payRow()).toMatchObject({
      rateCents: 20000,
      currency: 'EGP',
      paidMinutes: 120,
      payCents: 40000,
    });
    expect(await payRate()).toMatchObject({
      rateCents: 20000,
      source: 'LEVEL',
    });
  });

  it('shows the teacher their own hours and what they come to', async () => {
    const teacher = await t.login(school.teacher.email);
    const mine = (
      await t.http
        .get(`/api/stats/my-month?month=${month.toFormat('yyyy-MM')}`)
        .set(auth(teacher))
        .expect(200)
    ).body;
    expect(mine).toMatchObject({
      minutes: 120,
      rateCents: 20000,
      currency: 'EGP',
      expectedPayCents: 40000,
      paid: null,
    });
  });

  it('moves with the level and loses to the teacher’s own rate', async () => {
    await t.http
      .patch(`/api/teachers/${school.teacher.id}`)
      .set(auth(t.adminToken))
      .send({ level: 'PREMIUM' })
      .expect(200);
    expect(await payRow()).toMatchObject({ rateCents: 30000 });

    await t.http
      .patch(`/api/teachers/${school.teacher.id}`)
      .set(auth(t.adminToken))
      .send({ hourlyRateCents: 25000, rateCurrency: 'USD' })
      .expect(200);
    expect(await payRow()).toMatchObject({
      rateCents: 25000,
      currency: 'USD',
      payCents: 50000,
    });
    expect(await payRate()).toMatchObject({ source: 'TEACHER' });
    const levels = (
      await t.http
        .get('/api/level-pay-rates')
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    expect(
      levels.find((r: { level: string }) => r.level === 'PREMIUM'),
    ).toMatchObject({ teachers: 1, ownRate: 1 });

    await t.http
      .patch(`/api/teachers/${school.teacher.id}`)
      .set(auth(t.adminToken))
      .send({ hourlyRateCents: null })
      .expect(200);
    expect(await payRow()).toMatchObject({
      rateCents: 30000,
      currency: 'EGP',
    });
  });

  it('can remove a level rate, and logs which levels changed without amounts', async () => {
    await setRates([{ level: 'PREMIUM', hourlyRateCents: null }]).expect(200);
    expect(await payRow()).toMatchObject({ rateCents: null, payCents: null });

    const log = (
      await t.http
        .get('/api/audit-logs?action=pay.level-rates')
        .set(auth(staffToken))
        .expect(200)
    ).body;
    const items = log.items ?? log;
    expect(items.map((e: { summary: string }) => e.summary)).toEqual([
      'Changed pay per hour by level: Premium removed',
      'Changed pay per hour by level: Premium, Standard, Basic',
    ]);
    expect(JSON.stringify(items)).not.toContain('30000');
  });

  it('turns away a level twice or a bad amount', async () => {
    await setRates([
      { level: 'BASIC', hourlyRateCents: 100 },
      { level: 'BASIC', hourlyRateCents: 200 },
    ]).expect(400);
    await setRates([{ level: 'BASIC', hourlyRateCents: -1 }]).expect(400);
    await setRates([{ level: 'GOLD', hourlyRateCents: 1 }]).expect(400);
  });
});
