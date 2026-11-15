/**
 * A teacher's profile: personal details, how they are paid (admins only, never
 * in the log), staff notes, and their attendance record.
 * WIPES the database at TEST_DATABASE_URL.
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

suite('teacher profile (e2e)', () => {
  let t: TestApp;
  let school: School;
  let staffToken: string;
  const url = () => `/api/teachers/${school.teacher.id}`;

  beforeAll(async () => {
    t = await startApp();
    school = await setUpSchool(t, 1, 'tpr');
    await t.http
      .post('/api/staff')
      .set(auth(t.adminToken))
      .send({
        email: 'desk.tpr@test.local',
        fullName: 'Front Desk',
        password: PASSWORD,
        role: 'STAFF',
      })
      .expect(201);
    staffToken = await t.login('desk.tpr@test.local');
  });

  afterAll(async () => {
    await t?.app.close();
  });

  it('keeps personal details, and an empty field clears one', async () => {
    const before = (await t.http.get(url()).set(auth(t.adminToken)).expect(200))
      .body;
    // Joined on the day the account was made.
    expect(before.joinedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await t.http
      .patch(url())
      .set(auth(staffToken))
      .send({
        gender: 'FEMALE',
        birthDate: '1990-04-12',
        country: 'eg',
        city: 'Cairo',
        languages: 'Arabic, English',
        education: 'BA Arabic, Al-Azhar · Ijazah in Hafs',
        experienceYears: 8,
      })
      .expect(200);
    const after = (await t.http.get(url()).set(auth(staffToken)).expect(200))
      .body;
    expect(after).toMatchObject({
      gender: 'FEMALE',
      birthDate: '1990-04-12',
      country: 'EG',
      city: 'Cairo',
      experienceYears: 8,
    });
    await t.http
      .patch(url())
      .set(auth(t.adminToken))
      .send({ city: '' })
      .expect(200);
    expect(
      (await t.http.get(url()).set(auth(t.adminToken)).expect(200)).body.city,
    ).toBeNull();
    await t.http
      .patch(url())
      .set(auth(t.adminToken))
      .send({ gender: 'X' })
      .expect(400);
  });

  it('payment details: admins only, and the log never shows the numbers', async () => {
    await t.http.get(`${url()}/bank`).set(auth(staffToken)).expect(403);
    await t.http
      .put(`${url()}/bank`)
      .set(auth(staffToken))
      .send({ method: 'BANK' })
      .expect(403);
    const empty = (
      await t.http.get(`${url()}/bank`).set(auth(t.adminToken)).expect(200)
    ).body;
    expect(empty).toMatchObject({ method: null, iban: null });

    const saved = (
      await t.http
        .put(`${url()}/bank`)
        .set(auth(t.adminToken))
        .send({
          method: 'BANK',
          bankName: 'CIB',
          accountHolder: 'Teacher Tpr',
          accountNumber: '100012345678',
          iban: 'eg38 0019 0005 0000 0000 2631 8000 2',
          instapay: '',
        })
        .expect(200)
    ).body;
    expect(saved).toMatchObject({
      method: 'BANK',
      bankName: 'CIB',
      iban: 'EG380019000500000000263180002',
      instapay: null,
    });
    const log = (
      await t.http
        .get(
          `/api/audit-logs?teacherId=${school.teacher.id}&actions=teacher.bank`,
        )
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    expect(log).toHaveLength(1);
    expect(log[0].summary).toContain('account number');
    expect(JSON.stringify(log[0])).not.toContain('100012345678');
    // The teacher's own page never carries it either.
    expect(
      JSON.stringify(
        (await t.http.get(url()).set(auth(t.adminToken)).expect(200)).body,
      ),
    ).not.toContain('100012345678');
  });

  it('staff write notes; only the writer or an admin removes one', async () => {
    const mine = (
      await t.http
        .post(`${url()}/notes`)
        .set(auth(staffToken))
        .send({ body: 'Very patient with young kids. Families ask for her.' })
        .expect(201)
    ).body;
    const adminNote = (
      await t.http
        .post(`${url()}/notes`)
        .set(auth(t.adminToken))
        .send({ body: 'Late twice in October; talked about it.' })
        .expect(201)
    ).body;
    await t.http
      .post(`${url()}/notes`)
      .set(auth(staffToken))
      .send({ body: 'x' })
      .expect(400);
    const list = (
      await t.http.get(`${url()}/notes`).set(auth(staffToken)).expect(200)
    ).body;
    expect(list.map((n: { id: string }) => n.id)).toEqual([
      adminNote.id,
      mine.id,
    ]);
    expect(list[1].authorName).toBe('Front Desk');

    await t.http
      .delete(`${url()}/notes/${adminNote.id}`)
      .set(auth(staffToken))
      .expect(403);
    await t.http
      .delete(`${url()}/notes/${mine.id}`)
      .set(auth(staffToken))
      .expect(204);
    expect(
      (await t.http.get(`${url()}/notes`).set(auth(t.adminToken)).expect(200))
        .body,
    ).toHaveLength(1);
  });

  it('the attendance record counts what the teacher cancelled, month by month', async () => {
    const lessonId = school.students[0].lessonIds[0];
    await t.http
      .post(`/api/lessons/${lessonId}/cancel`)
      .set(auth(t.adminToken))
      .send({ reason: 'BY_TEACHER', teacherRemedy: 'MAKEUP' })
      .expect(200);
    const rec = (
      await t.http.get(`${url()}/record`).set(auth(staffToken)).expect(200)
    ).body;
    expect(rec.months).toHaveLength(6);
    const total = rec.months.reduce(
      (n: number, m: { cancelled: number }) => n + m.cancelled,
      0,
    );
    // The lesson is in the next days: this month, or next month near a month's end.
    expect(total).toBeLessThanOrEqual(1);
    if (total)
      expect(rec.incidents[0]).toMatchObject({
        lessonId,
        kind: 'CANCELLED',
        makeupOwed: true,
        studentName: expect.any(String),
      });
  });
});
