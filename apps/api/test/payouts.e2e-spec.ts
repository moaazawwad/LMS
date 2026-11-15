/**
 * Recording a teacher's monthly pay as paid. WIPES the database at TEST_DATABASE_URL.
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

suite('teacher payouts (e2e)', () => {
  let t: TestApp;
  let school: School;
  let pool: pg.Pool;
  let staffToken: string;
  const lastMonth = DateTime.now()
    .setZone(CAIRO)
    .minus({ months: 1 })
    .toFormat('yyyy-MM');
  const thisMonth = DateTime.now().setZone(CAIRO).toFormat('yyyy-MM');
  const nextMonth = DateTime.now()
    .setZone(CAIRO)
    .plus({ months: 1 })
    .toFormat('yyyy-MM');

  /** Put a lesson at a time and settle it. */
  const settle = (id: string, at: DateTime, state: 'HELD' | 'TO_CHECK') =>
    pool.query(
      `update lessons set starts_at = $2, closed_at = $2::timestamptz + interval '65 minutes',
         status = $3, attendance = $4 where id = $1`,
      [
        id,
        at.toJSDate(),
        state === 'HELD' ? 'COMPLETED' : 'SCHEDULED',
        state === 'HELD' ? 'BOTH' : 'STUDENT_ONLY',
      ],
    );
  const record = (body: object, token = t.adminToken) =>
    t.http
      .post('/api/payouts')
      .set(auth(token))
      .send({ teacherId: school.teacher.id, ...body });

  beforeAll(async () => {
    t = await startApp();
    school = await setUpSchool(t, 1, 'pay');
    pool = new pg.Pool({ connectionString: testDbUrl });
    await t.http
      .post('/api/staff')
      .set(auth(t.adminToken))
      .send({
        email: 'staff.pay@test.local',
        fullName: 'Staff Pay',
        password: PASSWORD,
        role: 'STAFF',
      })
      .expect(201);
    staffToken = await t.login('staff.pay@test.local');
    const ids = school.students[0].lessonIds;
    const base = DateTime.fromISO(`${lastMonth}-10T15:00`, { zone: CAIRO });
    await settle(ids[0], base, 'HELD');
    await settle(ids[1], base.plus({ days: 2 }), 'HELD');
    await settle(ids[2], base.plus({ days: 4 }), 'HELD');
    await settle(ids[3], base.plus({ days: 6 }), 'TO_CHECK');
  });

  afterAll(async () => {
    await pool?.end();
    await t?.app.close();
  });

  it('is for admins only', async () => {
    await t.http
      .get(`/api/payouts?month=${lastMonth}`)
      .set(auth(staffToken))
      .expect(403);
    await record({ month: lastMonth }, staffToken).expect(403);
  });

  it("needs the teacher's rate first", async () => {
    const res = await record({ month: lastMonth }).expect(400);
    expect(res.body.message).toContain('hourly rate');
    await t.http
      .patch(`/api/teachers/${school.teacher.id}`)
      .set(auth(t.adminToken))
      .send({ hourlyRateCents: 20000, rateCurrency: 'EGP' })
      .expect(200);
  });

  it('asks for an override while lessons are still to check, then records the month frozen', async () => {
    const blocked = await record({ month: lastMonth }).expect(422);
    expect(
      blocked.body.violations.map((v: { code: string }) => v.code),
    ).toEqual(['PAY_LESSONS_TO_CHECK']);
    expect(blocked.body.canOverride).toBe(true);
    const paid = (
      await record({
        month: lastMonth,
        override: true,
        note: 'Paid now; the missed one is not owed',
      }).expect(201)
    ).body;
    expect(paid).toMatchObject({
      month: lastMonth,
      lessons: 3,
      minutes: 180,
      rateCents: 20000,
      amountCents: 60000,
      currency: 'EGP',
    });

    const dup = await record({
      month: lastMonth,
      override: true,
      note: 'again',
    }).expect(409);
    expect(dup.body.message).toContain('already recorded');

    const listed = (
      await t.http
        .get(`/api/payouts?month=${lastMonth}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    expect(listed).toEqual([
      expect.objectContaining({
        teacherId: school.teacher.id,
        teacherName: 'Teacher pay',
        amountCents: 60000,
      }),
    ]);
    const mine = (
      await t.http
        .get(`/api/payouts?teacherId=${school.teacher.id}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    expect(mine).toHaveLength(1);
    await t.http.get('/api/payouts').set(auth(t.adminToken)).expect(400);
  });

  it('keeps amounts out of the activity log, which staff can read', async () => {
    const log = (
      await t.http
        .get(`/api/audit-logs?entityId=${school.teacher.id}`)
        .set(auth(staffToken))
        .expect(200)
    ).body as { action: string; summary: string; after: unknown }[];
    const entry = log.find((l) => l.action === 'teacher.payout')!;
    expect(entry.summary).toContain(
      'pay recorded as paid · 3 lessons, 3 hours · override',
    );
    expect(JSON.stringify(entry)).not.toMatch(/60000|600\.00|EGP|20000/);
  });

  it('a month that is not over needs an override, and a future month is refused', async () => {
    const start = DateTime.now()
      .setZone(CAIRO)
      .startOf('month')
      .plus({ minutes: 1 });
    await settle(school.students[0].lessonIds[4], start, 'HELD');
    const res = await record({ month: thisMonth }).expect(422);
    expect(res.body.violations.map((v: { code: string }) => v.code)).toEqual([
      'PAY_MONTH_NOT_OVER',
    ]);
    await record({ month: nextMonth }).expect(400);
    await record({ month: '2026-13' }).expect(400);
  });

  it('can be undone with a reason, and recorded again', async () => {
    const [p] = (
      await t.http
        .get(`/api/payouts?month=${lastMonth}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    await t.http
      .post(`/api/payouts/${p.id}/undo`)
      .set(auth(t.adminToken))
      .send({})
      .expect(400);
    await t.http
      .post(`/api/payouts/${p.id}/undo`)
      .set(auth(staffToken))
      .send({ note: 'mistake' })
      .expect(403);
    await t.http
      .post(`/api/payouts/${p.id}/undo`)
      .set(auth(t.adminToken))
      .send({ note: 'Recorded the wrong teacher' })
      .expect(200);
    expect(
      (
        await t.http
          .get(`/api/payouts?month=${lastMonth}`)
          .set(auth(t.adminToken))
          .expect(200)
      ).body,
    ).toEqual([]);
    await record({
      month: lastMonth,
      override: true,
      note: 'Paid again after checking',
    }).expect(201);
  });
});
