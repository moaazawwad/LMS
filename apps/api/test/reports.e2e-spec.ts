/**
 * The monthly report: money, lessons, students and (admins) teacher pay.
 * WIPES the database at TEST_DATABASE_URL.
 */
import { DateTime } from 'luxon';
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

suite('monthly report (e2e)', () => {
  let t: TestApp;
  let school: School;
  let staffToken: string;
  const thisMonth = DateTime.now().setZone('Africa/Cairo').toFormat('yyyy-MM');
  const report = async (month = thisMonth, token = t.adminToken) =>
    (
      await t.http
        .get(`/api/stats/monthly?month=${month}`)
        .set(auth(token))
        .expect(200)
    ).body;

  beforeAll(async () => {
    t = await startApp();
    school = await setUpSchool(t, 1, 'rep');
    await t.http
      .post('/api/staff')
      .set(auth(t.adminToken))
      .send({
        email: 'staff.rep@test.local',
        fullName: 'Staff Rep',
        password: PASSWORD,
        role: 'STAFF',
      })
      .expect(201);
    staffToken = await t.login('staff.rep@test.local');
  });

  afterAll(async () => {
    await t?.app.close();
  });

  it('counts the money issued, collected and still due', async () => {
    const before = await report();
    expect(before.money.issued).toEqual([
      { currency: 'USD', count: 1, cents: 8 * 1500 },
    ]);
    expect(before.money.collected).toEqual([]);
    expect(before.money.dueNow).toEqual([
      { currency: 'USD', count: 1, cents: 8 * 1500 },
    ]);

    const [inv] = (
      await t.http.get('/api/invoices').set(auth(t.adminToken)).expect(200)
    ).body;
    await t.http
      .post(`/api/invoices/${inv.id}/pay`)
      .set(auth(t.adminToken))
      .expect(200);
    const after = await report();
    expect(after.money.collected).toEqual([
      { currency: 'USD', count: 1, cents: 8 * 1500 },
    ]);
    expect(after.money.dueNow).toEqual([]);
    expect(after.inProgress).toBe(true);
  });

  it('says what happened to the lessons and who started', async () => {
    // The first lesson: the student cancels it in time.
    const studentToken = await t.login(school.students[0].email);
    const [first] = school.students[0].lessonIds;
    const lesson = (
      await t.http
        .get(`/api/lessons/${first}`)
        .set(auth(studentToken))
        .expect(200)
    ).body;
    await t.http
      .post(`/api/lessons/${first}/cancel`)
      .set(auth(studentToken))
      .send({})
      .expect(200);

    const month = DateTime.fromISO(lesson.startsAt)
      .setZone('Africa/Cairo')
      .toFormat('yyyy-MM');
    const r = await report(month);
    expect(r.lessons.byStudent).toBe(1);
    expect(r.lessons.held).toBe(0);
    // The next lesson is still to come, in its own month.
    const next = (
      await t.http
        .get(`/api/lessons/${school.students[0].lessonIds[1]}`)
        .set(auth(studentToken))
        .expect(200)
    ).body;
    const nextMonth = DateTime.fromISO(next.startsAt)
      .setZone('Africa/Cairo')
      .toFormat('yyyy-MM');
    expect((await report(nextMonth)).lessons.upcoming).toBeGreaterThan(0);

    const startMonth = DateTime.now()
      .setZone('America/New_York')
      .plus({ days: 2 })
      .toFormat('yyyy-MM');
    const s = await report(startMonth);
    expect(s.students).toEqual({ active: 1, started: 1 });
    expect(s.trend).toHaveLength(6);
    expect(s.trend[5].month).toBe(startMonth);
  });

  it('shows teacher pay to admins only, and money to staff with invoices', async () => {
    expect((await report()).teacherPay).toMatchObject({
      recorded: [],
      teachersPaid: 0,
    });
    expect((await report(thisMonth, staffToken)).teacherPay).toBeNull();

    const student = await t.login(school.students[0].email);
    await t.http
      .get(`/api/stats/monthly?month=${thisMonth}`)
      .set(auth(student))
      .expect(403);
    await t.http
      .get('/api/stats/monthly?month=2026-13')
      .set(auth(t.adminToken))
      .expect(400);

    const list = (
      await t.http.get('/api/staff').set(auth(t.adminToken)).expect(200)
    ).body as { id: string; email: string }[];
    const staffId = list.find((m) => m.email === 'staff.rep@test.local')!.id;
    await t.http
      .patch(`/api/staff/${staffId}`)
      .set(auth(t.adminToken))
      .send({ areas: ['lessons'] })
      .expect(200);
    await t.http
      .get(`/api/stats/monthly?month=${thisMonth}`)
      .set(auth(staffToken))
      .expect(403);
  });

  it("gives a teacher their own month's counts and their own pay only", async () => {
    const teacher = await t.login(school.teacher.email);
    const mine = (
      await t.http
        .get(`/api/stats/my-month?month=${thisMonth}`)
        .set(auth(teacher))
        .expect(200)
    ).body;
    expect(mine).toEqual({
      month: thisMonth,
      held: 0,
      studentAbsent: 0,
      counted: 0,
      minutes: 0,
      notCounted: 0,
      toCheck: 0,
      // No rate set for this teacher or their level yet: no amount to show.
      rateCents: null,
      currency: 'EGP',
      expectedPayCents: null,
      paid: null,
    });
    await t.http
      .get(`/api/stats/my-month?month=${thisMonth}`)
      .set(auth(t.adminToken))
      .expect(403);
    const student = await t.login(school.students[0].email);
    await t.http
      .get(`/api/stats/my-month?month=${thisMonth}`)
      .set(auth(student))
      .expect(403);
  });

  it('downloads the month as CSV, teacher pay for admins only', async () => {
    const res = await t.http
      .get(`/api/exports/month.csv?month=${thisMonth}`)
      .set(auth(t.adminToken))
      .expect(200);
    expect(res.headers['content-disposition']).toContain(
      `report_${thisMonth}.csv`,
    );
    const lines = res.text.replace(/^\uFEFF/, '').split('\r\n');
    expect(lines[0]).toBe('Section,Item,Number,Amount,Currency');
    expect(lines).toContain('Money,Collected,1,120.00,USD');
    expect(res.text).toContain('Teacher pay,Earned');
    // This staff member now works on lessons only.
    await t.http
      .get(`/api/exports/month.csv?month=${thisMonth}`)
      .set(auth(staffToken))
      .expect(403);
  });
});
