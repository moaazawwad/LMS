/**
 * Changing weekly times with "apply now": the upcoming lessons of the current
 * cycle move, and more or fewer lessons change the open invoice.
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

interface LessonRow {
  startsAt: string;
  status: string;
}

suite('change weekly times now (e2e)', () => {
  let t: TestApp;
  let school: School;
  let subscriptionId: string;

  const scheduled = async () =>
    (
      (
        await t.http
          .get(`/api/lessons?studentId=${school.students[0].id}`)
          .set(auth(t.adminToken))
          .expect(200)
      ).body as LessonRow[]
    ).filter((l) => l.status === 'SCHEDULED');
  const weekdays = (rows: LessonRow[]) =>
    [
      ...new Set(
        rows.map((l) =>
          DateTime.fromISO(l.startsAt, { zone: 'America/New_York' }).toFormat(
            'ccc HH:mm',
          ),
        ),
      ),
    ].sort();
  const invoice = async () => {
    const sub = (
      await t.http
        .get(`/api/subscriptions/${subscriptionId}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    return sub.cycles[0].invoice;
  };

  beforeAll(async () => {
    t = await startApp();
    // Tue and Thu 9 AM New York, from two days on; Standard at $15 a lesson.
    school = await setUpSchool(t, 1, 'now');
    subscriptionId = (
      await t.http
        .get(`/api/students/${school.students[0].id}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body.subscriptions[0].id;
  });

  afterAll(async () => {
    await t?.app.close();
  });

  it('without "now" the booked lessons stay as they are', async () => {
    await t.http
      .patch(`/api/subscriptions/${subscriptionId}`)
      .set(auth(t.adminToken))
      .send({
        slots: [
          { weekday: 1, startTime: '10:00' },
          { weekday: 3, startTime: '10:00' },
        ],
      })
      .expect(200);
    expect(weekdays(await scheduled())).toEqual(['Thu 09:00', 'Tue 09:00']);
  });

  it('moves the upcoming lessons to the new times now', async () => {
    const res = await t.http
      .patch(`/api/subscriptions/${subscriptionId}`)
      .set(auth(t.adminToken))
      .send({
        slots: [
          { weekday: 1, startTime: '10:00' },
          { weekday: 3, startTime: '10:00' },
        ],
        applyNow: true,
      })
      .expect(200);
    expect(res.body.moved).toMatchObject({ moved: 8, added: 0, dropped: 0 });
    const rows = await scheduled();
    expect(rows).toHaveLength(8);
    expect(weekdays(rows)).toEqual(['Mon 10:00', 'Wed 10:00']);
    expect(await invoice()).toMatchObject({
      lessonsCount: 8,
      totalCents: 8 * 1500,
    });
    const log = (
      await t.http
        .get(`/api/audit-logs?entityId=${subscriptionId}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    const items = log.items ?? log;
    // The newest entry: the move now (times were already set by the first change).
    expect(items[0].summary).toBe(
      'Student 1 now: from now: 8 upcoming lessons moved',
    );
    expect(items[1].summary).toBe(
      'Student 1 now: weekly times Tue 09:00, Thu 09:00 → Mon 10:00, Wed 10:00 (America/New_York) · from the next cycle',
    );
  });

  it('a day more adds extra lessons to the open invoice; a day less gives credits', async () => {
    const three = [
      { weekday: 1, startTime: '10:00' },
      { weekday: 3, startTime: '10:00' },
      { weekday: 5, startTime: '10:00' },
    ];
    const more = await t.http
      .patch(`/api/subscriptions/${subscriptionId}`)
      .set(auth(t.adminToken))
      .send({ slots: three, applyNow: true })
      .expect(200);
    expect(more.body.moved).toMatchObject({ moved: 8, added: 4 });
    expect(await scheduled()).toHaveLength(12);
    expect(await invoice()).toMatchObject({
      extraCount: 4,
      totalCents: 12 * 1500,
    });

    const less = await t.http
      .patch(`/api/subscriptions/${subscriptionId}`)
      .set(auth(t.adminToken))
      .send({ slots: three.slice(0, 1), applyNow: true })
      .expect(200);
    expect(less.body.moved).toMatchObject({ moved: 4, dropped: 8 });
    expect(weekdays(await scheduled())).toEqual(['Mon 10:00']);
    expect(await invoice()).toMatchObject({
      creditsCount: 8,
      totalCents: 4 * 1500,
    });
  });

  it('checks the new times against the teacher and their other lessons', async () => {
    // Make the teacher unavailable on Saturdays, then try a Saturday.
    await t.http
      .put(`/api/teachers/${school.teacher.id}/availability`)
      .set(auth(t.adminToken))
      .send({
        windows: [1, 2, 3, 4, 5, 7].map((weekday) => ({
          weekday,
          startMinute: 0,
          endMinute: 1440,
        })),
      })
      .expect(200);
    const res = await t.http
      .patch(`/api/subscriptions/${subscriptionId}`)
      .set(auth(t.adminToken))
      .send({ slots: [{ weekday: 6, startTime: '10:00' }], applyNow: true })
      .expect(422);
    expect(res.body.violations[0].message).toContain(
      'they have no hours on Sat',
    );
    // Nothing changed.
    expect(weekdays(await scheduled())).toEqual(['Mon 10:00']);
  });
});
