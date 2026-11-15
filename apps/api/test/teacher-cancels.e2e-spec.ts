/**
 * A teacher can cancel 4 lessons a month (Cairo calendar month of the
 * lesson). After that only an admin override with a note.
 * WIPES the database at TEST_DATABASE_URL.
 */
import { DateTime } from 'luxon';
import {
  auth,
  type School,
  setUpSchool,
  startApp,
  type TestApp,
  testDbUrl,
} from './helpers.js';

const suite = testDbUrl ? describe : describe.skip;

suite('teacher cancellations per month (e2e)', () => {
  let t: TestApp;
  let school: School;
  let teacherToken: string;
  /** six lessons of this teacher in one Cairo month, in time order */
  let month: string[];

  const ask = (lessonId: string) =>
    t.http
      .post('/api/requests')
      .set(auth(teacherToken))
      .send({ lessonId, kind: 'CANCEL', message: 'Doctor appointment.' });
  const openRequestFor = async (lessonId: string) =>
    (
      (
        await t.http
          .get('/api/requests?status=OPEN')
          .set(auth(t.adminToken))
          .expect(200)
      ).body as {
        id: string;
        lesson: { id: string };
        rules: { code: string }[];
      }[]
    ).find((r) => r.lesson.id === lessonId)!;

  beforeAll(async () => {
    t = await startApp();
    // Two students: 16 lessons over four weeks, so one month has at least 8.
    school = await setUpSchool(t, 2, 'tc');
    teacherToken = await t.login(school.teacher.email);
    const all = (
      await t.http
        .get(`/api/lessons?teacherId=${school.teacher.id}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body as { id: string; startsAt: string }[];
    const byMonth = new Map<string, string[]>();
    for (const l of all) {
      const m = DateTime.fromISO(l.startsAt)
        .setZone('Africa/Cairo')
        .toFormat('yyyy-MM');
      byMonth.set(m, [...(byMonth.get(m) ?? []), l.id]);
    }
    month = [...byMonth.values()]
      .sort((a, b) => b.length - a.length)[0]
      .slice(0, 6);
    expect(month).toHaveLength(6);
  });

  afterAll(async () => {
    await t?.app.close();
  });

  it('lets the teacher ask four times; staff approve within the limit', async () => {
    for (const id of month.slice(0, 4)) await ask(id).expect(201);
    for (const id of month.slice(0, 3)) {
      const req = await openRequestFor(id);
      expect(req.rules).toEqual([]);
      await t.http
        .post(`/api/requests/${req.id}/approve`)
        .set(auth(t.adminToken))
        .send({ teacherRemedy: 'CREDIT' })
        .expect(200);
    }
    // Staff cancelling for the teacher counts too: that is the fourth.
    await t.http
      .post(`/api/lessons/${month[4]}/cancel`)
      .set(auth(t.adminToken))
      .send({ reason: 'BY_TEACHER', teacherRemedy: 'MAKEUP' })
      .expect(200);
    const lesson = (
      await t.http
        .get(`/api/lessons/${month[5]}`)
        .set(auth(teacherToken))
        .expect(200)
    ).body;
    expect(lesson.teacherCancels).toMatchObject({ used: 4, limit: 4 });
  });

  it('past the limit, approving needs an override with the admin’s own note', async () => {
    const req = await openRequestFor(month[3]);
    expect(req.rules.map((r) => r.code)).toEqual(['TEACHER_CANCEL_LIMIT']);
    const blocked = await t.http
      .post(`/api/requests/${req.id}/approve`)
      .set(auth(t.adminToken))
      .send({ teacherRemedy: 'CREDIT' })
      .expect(422);
    expect(blocked.body).toMatchObject({ canOverride: true });
    expect(blocked.body.violations[0].code).toBe('TEACHER_CANCEL_LIMIT');
    await t.http
      .post(`/api/requests/${req.id}/approve`)
      .set(auth(t.adminToken))
      .send({
        teacherRemedy: 'CREDIT',
        override: true,
        note: 'Hospital, has a letter.',
      })
      .expect(200);
  });

  it('stops the teacher asking again this month', async () => {
    const res = await ask(month[5]).expect(422);
    expect(res.body).toMatchObject({ canOverride: false });
    expect(res.body.message).toContain('You have used all 4 cancellations for');
    // Staff can still cancel it, with an override and a note.
    await t.http
      .post(`/api/lessons/${month[5]}/cancel`)
      .set(auth(t.adminToken))
      .send({ reason: 'BY_TEACHER' })
      .expect(422);
    await t.http
      .post(`/api/lessons/${month[5]}/cancel`)
      .set(auth(t.adminToken))
      .send({
        reason: 'BY_TEACHER',
        override: true,
        note: 'Teacher travelling, agreed with the owner.',
      })
      .expect(200);
    const logs = (
      await t.http
        .get(`/api/audit-logs?entityId=${month[5]}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body as { action: string; override: boolean }[];
    expect(logs.find((l) => l.action === 'lesson.cancel')?.override).toBe(true);
  });

  it('shows staff the count on the teacher page', async () => {
    const teacher = (
      await t.http
        .get(`/api/teachers/${school.teacher.id}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    expect(teacher.cancelsThisMonth).toMatchObject({ limit: 4 });
    expect(typeof teacher.cancelsThisMonth.used).toBe('number');
  });
});
