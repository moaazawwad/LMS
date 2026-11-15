/**
 * Staff accounts can be limited to parts of the academy; admins and existing
 * staff keep everything. WIPES the database at TEST_DATABASE_URL.
 */
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

suite('staff areas (e2e)', () => {
  let t: TestApp;
  let school: School;
  let staffId: string;
  let staffToken: string;

  beforeAll(async () => {
    t = await startApp();
    school = await setUpSchool(t, 1, 'area');
  });

  afterAll(async () => {
    await t?.app.close();
  });

  it('a new staff member gets only the areas the admin ticks', async () => {
    const created = (
      await t.http
        .post('/api/staff')
        .set(auth(t.adminToken))
        .send({
          email: 'sched@test.local',
          fullName: 'Scheduler',
          password: PASSWORD,
          role: 'STAFF',
          areas: ['lessons'],
        })
        .expect(201)
    ).body;
    expect(created.areas).toEqual(['lessons']);
    staffId = created.id;
    const login = (
      await t.http
        .post('/api/auth/login')
        .send({ email: 'sched@test.local', password: PASSWORD })
        .expect(200)
    ).body;
    expect(login.user.areas).toEqual(['lessons']);
    staffToken = login.accessToken;
    expect(
      (await t.http.get('/api/auth/me').set(auth(staffToken)).expect(200)).body
        .areas,
    ).toEqual(['lessons']);

    await t.http
      .post('/api/staff')
      .set(auth(t.adminToken))
      .send({
        email: 'bad@test.local',
        fullName: 'Bad',
        password: PASSWORD,
        role: 'STAFF',
        areas: ['money'],
      })
      .expect(400);
  });

  it('works on lessons, looks things up, and is kept out of the rest', async () => {
    const [, lessonId] = school.students[0].lessonIds;
    await t.http
      .post(`/api/lessons/${lessonId}/cancel`)
      .set(auth(staffToken))
      .send({ reason: 'BY_STUDENT' })
      .expect(200);
    await t.http.get('/api/students').set(auth(staffToken)).expect(200);
    await t.http
      .get(`/api/students/${school.students[0].id}`)
      .set(auth(staffToken))
      .expect(200);
    await t.http.get('/api/teachers').set(auth(staffToken)).expect(200);

    const refused = await t.http
      .get('/api/invoices')
      .set(auth(staffToken))
      .expect(403);
    expect(refused.body.message).toContain('Ask an admin');
    await t.http.get('/api/invoices/summary').set(auth(staffToken)).expect(403);
    await t.http
      .get('/api/exports/invoices.csv?from=2026-01-01&to=2026-01-31')
      .set(auth(staffToken))
      .expect(403);
    await t.http.get('/api/audit-logs').set(auth(staffToken)).expect(403);
    await t.http
      .post('/api/students')
      .set(auth(staffToken))
      .send({
        email: 'n@test.local',
        fullName: 'New One',
        password: PASSWORD,
        timezone: 'America/New_York',
      })
      .expect(403);
    await t.http
      .post('/api/curricula')
      .set(auth(staffToken))
      .send({ name: 'Nope' })
      .expect(403);

    // Students and teachers are never limited by this.
    const studentToken = await t.login(school.students[0].email);
    await t.http.get('/api/invoices').set(auth(studentToken)).expect(200);
  });

  it('a change by the admin applies at once, and ticking everything removes the limit', async () => {
    const updated = (
      await t.http
        .patch(`/api/staff/${staffId}`)
        .set(auth(t.adminToken))
        .send({ areas: ['billing', 'logs'] })
        .expect(200)
    ).body;
    expect(updated.areas).toEqual(['billing', 'logs']);
    await t.http.get('/api/invoices').set(auth(staffToken)).expect(200);
    await t.http.get('/api/audit-logs').set(auth(staffToken)).expect(200);
    const [, , lessonId] = school.students[0].lessonIds;
    await t.http
      .post(`/api/lessons/${lessonId}/cancel`)
      .set(auth(staffToken))
      .send({ reason: 'BY_STUDENT' })
      .expect(403);

    const log = (
      await t.http
        .get(`/api/audit-logs?entityId=${staffId}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    expect(log[0].summary).toContain('works on billing, logs');

    const all = [
      'students',
      'teachers',
      'lessons',
      'billing',
      'catalog',
      'logs',
    ];
    expect(
      (
        await t.http
          .patch(`/api/staff/${staffId}`)
          .set(auth(t.adminToken))
          .send({ areas: all })
          .expect(200)
      ).body.areas,
    ).toBeNull();
    await t.http
      .post(`/api/lessons/${lessonId}/cancel`)
      .set(auth(staffToken))
      .send({ reason: 'BY_STUDENT' })
      .expect(200);
  });

  it('admins always have everything', async () => {
    await t.http
      .patch(`/api/staff/${staffId}`)
      .set(auth(t.adminToken))
      .send({ areas: ['logs'] })
      .expect(200);
    const admin = (
      await t.http
        .patch(`/api/staff/${staffId}`)
        .set(auth(t.adminToken))
        .send({ role: 'ADMIN' })
        .expect(200)
    ).body;
    expect(admin.areas).toBeNull();
    const list = (
      await t.http.get('/api/staff').set(auth(t.adminToken)).expect(200)
    ).body as { id: string; areas: string[] | null }[];
    expect(list.find((s) => s.id === staffId)!.areas).toBeNull();
  });
});
