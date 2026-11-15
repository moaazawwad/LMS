/**
 * The staff Lessons page: lessons by kind, paging, and each lesson's history.
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

interface Row {
  id: string;
  type: string;
  status: string;
  movedTo?: { id: string };
}

suite('lessons by kind (e2e)', () => {
  let t: TestApp;
  let school: School;
  const list = async (query: string) =>
    (
      await t.http
        .get(`/api/lessons?${query}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body as Row[];

  beforeAll(async () => {
    t = await startApp();
    school = await setUpSchool(t, 1, 'kind');
    const [first, second] = school.students[0].lessonIds;
    // One cancelled, one moved to a new time.
    await t.http
      .post(`/api/lessons/${first}/cancel`)
      .set(auth(t.adminToken))
      .send({ reason: 'BY_ADMIN' })
      .expect(200);
    const lesson = (
      await t.http
        .get(`/api/lessons/${second}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    await t.http
      .post(`/api/lessons/${second}/reschedule`)
      .set(auth(t.adminToken))
      .send({
        startsAt: DateTime.fromISO(lesson.startsAt).plus({ hours: 3 }).toISO(),
        requestedBy: 'ADMIN',
      })
      .expect(201);
    // And a trial.
    await t.http
      .post('/api/lessons/trial')
      .set(auth(t.adminToken))
      .send({
        studentId: school.students[0].id,
        teacherId: school.teacher.id,
        curriculumId: school.curriculumId,
        startsAt: DateTime.now().plus({ days: 1 }).set({ minute: 0 }).toISO(),
        durationMin: 60,
      })
      .expect(201);
  });

  afterAll(async () => {
    await t?.app.close();
  });

  it('lists each kind', async () => {
    const s = `studentId=${school.students[0].id}`;
    expect((await list(`${s}&kind=cancelled`)).map((l) => l.status)).toEqual([
      'CANCELLED',
    ]);
    const moved = await list(`${s}&kind=rescheduled`);
    expect(moved).toHaveLength(1);
    expect(moved[0].movedTo?.id).toBeTruthy();
    expect((await list(`${s}&kind=trial`)).map((l) => l.type)).toEqual([
      'TRIAL',
    ]);
    const regular = await list(`${s}&kind=regular`);
    expect(
      regular.every((l) => l.type !== 'TRIAL' && l.status !== 'RESCHEDULED'),
    ).toBe(true);
    expect(regular.length).toBe(8); // 8 in the cycle: one cancelled, one moved (the new one counts)
  });

  it('pages with limit and offset', async () => {
    const s = `studentId=${school.students[0].id}&kind=regular`;
    const a = await list(`${s}&limit=5`);
    const b = await list(`${s}&limit=5&offset=5`);
    expect(a).toHaveLength(5);
    expect(b).toHaveLength(3);
    expect(new Set([...a, ...b].map((l) => l.id)).size).toBe(8);
  });

  it("tells a lesson's history", async () => {
    const [moved] = await list(
      `studentId=${school.students[0].id}&kind=rescheduled`,
    );
    const h = (
      await t.http
        .get(`/api/lessons/${moved.id}/history`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    expect(h.movedTo).toHaveLength(1);
    expect(h.invoice).toMatchObject({ number: expect.stringMatching(/^INV-/) });
    expect(h.meetingLink === null || typeof h.meetingLink === 'string').toBe(
      true,
    );
    const there = (
      await t.http
        .get(`/api/lessons/${h.movedTo[0].id}/history`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    expect(there.movedFrom).toMatchObject({ id: moved.id });

    const [cancelled] = await list(
      `studentId=${school.students[0].id}&kind=cancelled`,
    );
    const c = (
      await t.http
        .get(`/api/lessons/${cancelled.id}/history`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    expect(c).toMatchObject({ cancelledBy: 'ADMIN' });
    expect(c.cancelledAt).toBeTruthy();

    const teacherToken = await t.login(school.teacher.email);
    await t.http
      .get(`/api/lessons/${moved.id}/history`)
      .set(auth(teacherToken))
      .expect(403);
  });
});
