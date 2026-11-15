/**
 * Students with an address and country, and free trial lessons.
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

suite('trial lessons and student details (e2e)', () => {
  let t: TestApp;
  let school: School;
  let studentId: string;
  // Next Monday 10 AM Cairo: the test teacher is free all week.
  const monday = DateTime.now()
    .setZone('Africa/Cairo')
    .plus({ weeks: 1 })
    .set({ weekday: 1, hour: 10, minute: 0, second: 0, millisecond: 0 });

  const book = (body: object = {}) =>
    t.http
      .post('/api/lessons/trial')
      .set(auth(t.adminToken))
      .send({
        studentId,
        teacherId: school.teacher.id,
        curriculumId: school.curriculumId,
        startsAt: monday.toISO(),
        durationMin: 30,
        ...body,
      });

  beforeAll(async () => {
    t = await startApp();
    school = await setUpSchool(t, 0, 'trl');
  });

  afterAll(async () => {
    await t?.app.close();
  });

  it('keeps the address and country apart from the time zone', async () => {
    const res = await t.http
      .post('/api/students')
      .set(auth(t.adminToken))
      .send({
        email: 'lina.trl@test.local',
        fullName: 'Lina Trial',
        password: PASSWORD,
        timezone: 'Europe/London',
        country: 'GB',
        address: '1 High Street, Leeds',
        phone: '+44 7700 900123',
      })
      .expect(201);
    studentId = res.body.id;
    const s = (
      await t.http
        .get(`/api/students/${studentId}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    expect(s).toMatchObject({
      country: 'GB',
      address: '1 High Street, Leeds',
      timezone: 'Europe/London',
      phone: '+44 7700 900123',
    });
    await t.http
      .patch(`/api/students/${studentId}`)
      .set(auth(t.adminToken))
      .send({ country: 'gb' })
      .expect(400);
    await t.http
      .patch(`/api/students/${studentId}`)
      .set(auth(t.adminToken))
      .send({ country: 'IE', address: '2 Main St, Dublin' })
      .expect(200);
    const log = (
      await t.http
        .get(`/api/audit-logs?entityId=${studentId}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    expect(log[0].changes).toEqual(
      expect.arrayContaining([
        { field: 'country', from: 'GB', to: 'IE' },
        {
          field: 'address',
          from: '1 High Street, Leeds',
          to: '2 Main St, Dublin',
        },
      ]),
    );
  });

  it("lists the teacher's free times for a trial", async () => {
    const res = await t.http
      .get(
        `/api/lessons/trial-slots?teacherId=${school.teacher.id}&studentId=${studentId}&date=${monday.setZone('Europe/London').toISODate()}&durationMin=30`,
      )
      .set(auth(t.adminToken))
      .expect(200);
    expect(res.body.timezone).toBe('Europe/London');
    expect(res.body.slots.length).toBeGreaterThan(20);
  });

  it('books a free one-off lesson: no subscription, no invoice', async () => {
    const lesson = (await book().expect(201)).body;
    expect(lesson).toMatchObject({
      type: 'TRIAL',
      subscriptionId: null,
      cycleId: null,
      durationMin: 30,
    });
    const invoices = (
      await t.http
        .get(`/api/invoices?studentId=${studentId}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    expect(invoices.items ?? invoices).toHaveLength(0);

    // The same time again clashes with it.
    const clash = await book().expect(422);
    expect(clash.body.violations[0].code).toBe('TIME_CONFLICT');

    // Cancelling it by the student gives no credit.
    await t.http
      .post(`/api/lessons/${lesson.id}/cancel`)
      .set(auth(t.adminToken))
      .send({ reason: 'BY_STUDENT' })
      .expect(200);
    const after = (
      await t.http
        .get(`/api/lessons/${lesson.id}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    expect(after).toMatchObject({ status: 'CANCELLED', countedAsTaken: false });
    const overview = (
      await t.http
        .get(`/api/students/${studentId}/overview`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    expect(overview.pendingCredits ?? 0).toBe(0);
  });

  it('is for staff, with the usual checks', async () => {
    await book({ curriculumId: '00000000-0000-4000-8000-000000000000' }).expect(
      400,
    );
    await book({ durationMin: 45 }).expect(400);
    await book({ startsAt: DateTime.now().minus({ hours: 1 }).toISO() }).expect(
      422,
    );
    const teacherToken = await t.login(school.teacher.email);
    await book().set(auth(teacherToken)).expect(403);
  });
});
