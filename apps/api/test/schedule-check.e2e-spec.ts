/**
 * Looking ahead: lessons that cannot go ahead as booked (outside the
 * teacher's hours, or on top of another lesson) and the coming clock changes.
 * Clock-change maths is covered by rules/clock.spec.ts with fixed dates.
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
const byText = (a: string | undefined, b: string | undefined) =>
  (a ?? '').localeCompare(b ?? '');

interface Check {
  clockChanges: {
    timezone: string;
    at: string;
    offsetBefore: number;
    offsetAfter: number;
    students: number | null;
  }[];
  movedLessons: number;
  problems: {
    kind: string;
    lesson: { id: string; student: { id: string } };
    with: { id: string } | null;
    clockShiftMin: number;
  }[];
}

suite('schedule check (e2e)', () => {
  let t: TestApp;
  let school: School;

  const check = async (token = t.adminToken) =>
    (
      await t.http
        .get('/api/lessons/schedule-check')
        .set(auth(token))
        .expect(200)
    ).body as Check;

  beforeAll(async () => {
    t = await startApp();
    // Two New York students with the same teacher: Tue/Thu at 9:00 and 11:00 New York time.
    school = await setUpSchool(t, 2, 'clk');
  });

  afterAll(async () => {
    await t?.app.close();
  });

  it('finds nothing wrong with a fresh booking, and lists clock changes in the zones in use', async () => {
    const body = await check();
    expect(body.problems).toEqual([]);
    for (const c of body.clockChanges) {
      expect(['Africa/Cairo', 'America/New_York']).toContain(c.timezone);
      expect(c.offsetBefore).not.toBe(c.offsetAfter);
      expect(c.students).toBe(c.timezone === 'Africa/Cairo' ? null : 2);
    }
    expect(body.movedLessons).toBeGreaterThanOrEqual(0);
  });

  it('flags lessons left outside new teacher hours, and says so when the hours are saved', async () => {
    // Every day until 5:30 PM Cairo: 9:00 New York (3 or 4 PM Cairo) fits, 11:00 (5 or 6 PM) does not.
    const res = await t.http
      .put(`/api/teachers/${school.teacher.id}/availability`)
      .set(auth(t.adminToken))
      .send({
        windows: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
          weekday,
          startMinute: 0,
          endMinute: 17 * 60 + 30,
        })),
      })
      .expect(200);
    const second = school.students[1];
    expect(res.body.lessonsOutside).toBe(second.lessonIds.length);

    const body = await check();
    expect(
      body.problems.every(
        (p) => p.kind === 'OUTSIDE_HOURS' && p.lesson.student.id === second.id,
      ),
    ).toBe(true);
    expect(body.problems.map((p) => p.lesson.id).sort(byText)).toEqual(
      [...second.lessonIds].sort(byText),
    );
  });

  it('flags a lesson booked on top of another for the same teacher', async () => {
    // Back to all-day hours, then an extra lesson right on top of the first student's next one.
    await t.http
      .put(`/api/teachers/${school.teacher.id}/availability`)
      .set(auth(t.adminToken))
      .send({
        windows: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
          weekday,
          startMinute: 0,
          endMinute: 1440,
        })),
      })
      .expect(200);
    const first = school.students[0];
    const firstLesson = (
      await t.http
        .get(`/api/lessons/${first.lessonIds[0]}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    const subscriptionId = (
      await t.http
        .get(`/api/students/${school.students[1].id}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body.subscriptions[0].id;
    const extra = (
      await t.http
        .post('/api/lessons/extra')
        .set(auth(t.adminToken))
        .send({
          subscriptionId,
          startsAt: firstLesson.startsAt,
          extraReason: 'MAKEUP',
          override: true,
          note: 'Booked over on purpose for the test.',
        })
        .expect(201)
    ).body;

    const body = await check();
    expect(body.problems).toHaveLength(1);
    const [clash] = body.problems;
    expect(clash.kind).toBe('TEACHER_CLASH');
    expect([clash.lesson.id, clash.with?.id].sort(byText)).toEqual(
      [extra.id, first.lessonIds[0]].sort(byText),
    );
  });

  it('is for staff only, and gives every lesson its shift on the Cairo clock', async () => {
    const teacherToken = await t.login(school.teacher.email);
    await t.http
      .get('/api/lessons/schedule-check')
      .set(auth(teacherToken))
      .expect(403);
    await t.http
      .get('/api/lessons/schedule-check?days=500')
      .set(auth(t.adminToken))
      .expect(400);
    const lessons = (
      await t.http
        .get(`/api/lessons?studentId=${school.students[0].id}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body as { clockShiftMin: number; startsAt: string }[];
    for (const l of lessons) {
      // New York and Cairo differ by 6 or 7 hours: a lesson can only move by 0 or an hour.
      expect([0, 60, -60]).toContain(l.clockShiftMin);
    }
    // A lesson in the past is never "moved".
    expect(DateTime.fromISO(lessons[0].startsAt) > DateTime.now()).toBe(true);
  });
});
