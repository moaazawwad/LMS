/**
 * Moving a subscription to another teacher: which teachers fit, and why not.
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

interface Option {
  teacherId: string;
  name: string;
  lessons: number;
  outsideHours: number;
  busy: number;
  levelTooLow: boolean;
}

suite('teacher transfer (e2e)', () => {
  let t: TestApp;
  let school: School;
  let subscriptionId: string;
  const ids: Record<string, string> = {};

  const teacher = async (
    key: string,
    level: string,
    windows: { weekday: number; startMinute: number; endMinute: number }[],
  ) => {
    const made = (
      await t.http
        .post('/api/teachers')
        .set(auth(t.adminToken))
        .send({
          email: `${key}.trf@test.local`,
          fullName: `Teacher ${key}`,
          password: PASSWORD,
          level,
          curriculumIds: [school.curriculumId],
        })
        .expect(201)
    ).body;
    await t.http
      .put(`/api/teachers/${made.id}/availability`)
      .set(auth(t.adminToken))
      .send({ windows })
      .expect(200);
    ids[key] = made.id;
  };

  beforeAll(async () => {
    t = await startApp();
    // Lessons are Tue and Thu, 9 AM New York = 4 PM Cairo.
    school = await setUpSchool(t, 1, 'trf');
    subscriptionId = (
      await t.http
        .get(`/api/students/${school.students[0].id}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body.subscriptions[0].id;
    const allWeek = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
      weekday,
      startMinute: 0,
      endMinute: 1440,
    }));
    await teacher('full', 'STANDARD', allWeek);
    // Tuesday in two back-to-back windows (3-4 PM and 4-5 PM Cairo), no Thursday.
    await teacher('tue', 'STANDARD', [
      { weekday: 2, startMinute: 15 * 60, endMinute: 16 * 60 },
      { weekday: 2, startMinute: 16 * 60, endMinute: 17 * 60 },
    ]);
    await teacher('basic', 'BASIC', allWeek);
  });

  afterAll(async () => {
    await t?.app.close();
  });

  it('lists each teacher with how the upcoming lessons fit', async () => {
    const options = (
      await t.http
        .get(`/api/subscriptions/${subscriptionId}/transfer-options`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body as Option[];
    const by = (id: string) => options.find((o) => o.teacherId === id)!;
    expect(options.map((o) => o.teacherId)).not.toContain(school.teacher.id);
    expect(by(ids.full)).toMatchObject({
      lessons: 8,
      outsideHours: 0,
      busy: 0,
      levelTooLow: false,
    });
    // Tuesday fits across the two windows; the 4 Thursdays do not.
    expect(by(ids.tue)).toMatchObject({ outsideHours: 4, levelTooLow: false });
    expect(by(ids.basic)).toMatchObject({ outsideHours: 0, levelTooLow: true });
  });

  it('says why a teacher does not fit', async () => {
    const res = await t.http
      .post(`/api/subscriptions/${subscriptionId}/transfer`)
      .set(auth(t.adminToken))
      .send({ teacherId: ids.tue })
      .expect(422);
    const messages = res.body.violations.map(
      (v: { message: string }) => v.message,
    );
    expect(messages).toHaveLength(4);
    expect(messages[0]).toContain(
      'The teacher is not available at that time; they have no hours on Thu (Cairo).',
    );
  });

  it('moves the lessons to a teacher who fits', async () => {
    await t.http
      .post(`/api/subscriptions/${subscriptionId}/transfer`)
      .set(auth(t.adminToken))
      .send({ teacherId: ids.full })
      .expect(200);
    const sub = (
      await t.http
        .get(`/api/subscriptions/${subscriptionId}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    expect(sub.teacherId).toBe(ids.full);
  });
});
