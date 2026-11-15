/**
 * After the lesson: who came decides what is counted and whether the teacher
 * is paid; staff check the rest. Extra lessons go on the bill.
 * WIPES the database at TEST_DATABASE_URL.
 */
import { DateTime } from 'luxon';
import pg from 'pg';
import { CyclesService } from '../src/billing/cycles.service.js';
import { AttendanceService } from '../src/lessons/attendance.service.js';
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

interface LessonView {
  id: string;
  startsAt: string;
  durationMin: number;
  status: string;
  attendance: string | null;
  teacherPaid?: boolean | null;
  needsReview?: boolean;
  reviewOptions?: string[];
  cancelReason: string | null;
}

suite('attendance and extra lessons (e2e)', () => {
  let t: TestApp;
  let school: School;
  let pool: pg.Pool;
  let lessons: LessonView[];
  let studentToken: string;
  let teacherToken: string;
  let afterFour: Date;

  const lesson = async (id: string, token = t.adminToken) =>
    (await t.http.get(`/api/lessons/${id}`).set(auth(token)).expect(200))
      .body as LessonView;
  const review = (id: string, body: object, token = t.adminToken) =>
    t.http.post(`/api/lessons/${id}/attendance`).set(auth(token)).send(body);
  /** Pretend people pressed Enter class at the start. */
  const entered = (id: string, who: { teacher?: boolean; student?: boolean }) =>
    pool.query(
      `update lessons set teacher_joined_at = case when $2 then starts_at end, student_joined_at = case when $3 then starts_at end,
         status = case when $2 and $3 then 'COMPLETED'::lesson_status else status end where id = $1`,
      [id, !!who.teacher, !!who.student],
    );

  beforeAll(async () => {
    t = await startApp();
    pool = new pg.Pool({ connectionString: testDbUrl });
    school = await setUpSchool(t, 1, 'att');
    studentToken = await t.login(school.students[0].email);
    teacherToken = await t.login(school.teacher.email);
    lessons = await Promise.all(
      school.students[0].lessonIds.map((id) => lesson(id)),
    );
    const fourth = lessons[3];
    afterFour = new Date(
      new Date(fourth.startsAt).getTime() + (fourth.durationMin + 10) * 60_000,
    );
  });

  afterAll(async () => {
    await pool?.end();
    await t?.app.close();
  });

  it('settles finished lessons by who entered class', async () => {
    await entered(lessons[0].id, { teacher: true, student: true });
    await entered(lessons[1].id, { teacher: true });
    await entered(lessons[2].id, { student: true });
    // lessons[3]: nobody pressed anything.
    const attendance = t.app.get(AttendanceService);
    expect(await attendance.closeEnded(afterFour)).toBe(4);
    // Running again changes nothing.
    expect(await attendance.closeEnded(afterFour)).toBe(0);

    const [both, teacherOnly, studentOnly, none] = await Promise.all(
      lessons.slice(0, 4).map((l) => lesson(l.id)),
    );
    expect(both).toMatchObject({
      status: 'COMPLETED',
      attendance: 'BOTH',
      teacherPaid: true,
      needsReview: false,
    });
    expect(teacherOnly).toMatchObject({
      status: 'COMPLETED',
      attendance: 'TEACHER_ONLY',
      teacherPaid: true,
      needsReview: true,
      reviewOptions: ['CONFIRM', 'HELD'],
    });
    expect(studentOnly).toMatchObject({
      status: 'SCHEDULED',
      attendance: 'STUDENT_ONLY',
      teacherPaid: false,
      needsReview: true,
    });
    expect(none).toMatchObject({
      status: 'SCHEDULED',
      attendance: 'NONE',
      teacherPaid: false,
      needsReview: true,
    });
    // Not finished yet.
    expect(await lesson(lessons[4].id)).toMatchObject({
      attendance: null,
      teacherPaid: null,
      needsReview: false,
    });
  });

  it('shows staff what to check, oldest first, and keeps pay details from teachers and students', async () => {
    const { http } = t;
    const list = (
      await http
        .get('/api/lessons/attendance-review')
        .set(auth(t.adminToken))
        .expect(200)
    ).body as LessonView[];
    expect(list.map((l) => l.id)).toEqual([
      lessons[1].id,
      lessons[2].id,
      lessons[3].id,
    ]);
    expect(
      (
        await http
          .get('/api/stats/overview')
          .set(auth(t.adminToken))
          .expect(200)
      ).body.attendanceToCheck,
    ).toBe(3);

    await http
      .get('/api/lessons/attendance-review')
      .set(auth(teacherToken))
      .expect(403);
    await http
      .get('/api/lessons/attendance-review')
      .set(auth(studentToken))
      .expect(403);
    const seenByTeacher = await lesson(lessons[2].id, teacherToken);
    expect(seenByTeacher.attendance).toBe('STUDENT_ONLY');
    expect(seenByTeacher).not.toHaveProperty('teacherPaid');
    expect(seenByTeacher).not.toHaveProperty('needsReview');
    expect(await lesson(lessons[1].id, studentToken)).not.toHaveProperty(
      'teacherPaid',
    );
  });

  it('only takes outcomes that fit what was recorded, from staff', async () => {
    await review(lessons[1].id, { outcome: 'NOBODY_CAME' }).expect(400);
    await review(lessons[1].id, { outcome: 'MAYBE' }).expect(400);
    await review(lessons[1].id, { outcome: 'CONFIRM' }, teacherToken).expect(
      403,
    );
    await review(lessons[1].id, { outcome: 'CONFIRM' }, studentToken).expect(
      403,
    );
    // Not over yet.
    await review(lessons[4].id, { outcome: 'HELD' }).expect(409);
  });

  it('records a student absence, a missing teacher (makeup owed) and nobody coming', async () => {
    const absent = (
      await review(lessons[1].id, { outcome: 'CONFIRM' }).expect(200)
    ).body as LessonView;
    expect(absent).toMatchObject({
      status: 'COMPLETED',
      attendance: 'TEACHER_ONLY',
      teacherPaid: true,
      needsReview: false,
    });
    // Once.
    await review(lessons[1].id, { outcome: 'HELD' }).expect(409);

    const teacherAbsent = (
      await review(lessons[2].id, {
        outcome: 'TEACHER_ABSENT',
        teacherRemedy: 'MAKEUP',
        note: 'Teacher was ill.',
      }).expect(200)
    ).body as LessonView;
    expect(teacherAbsent).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'BY_TEACHER',
      teacherPaid: false,
      needsReview: false,
    });

    const nobody = (
      await review(lessons[3].id, { outcome: 'NOBODY_CAME' }).expect(200)
    ).body as LessonView;
    expect(nobody).toMatchObject({
      status: 'COMPLETED',
      attendance: 'NONE',
      teacherPaid: false,
    });

    expect(
      (
        await t.http
          .get('/api/lessons/attendance-review')
          .set(auth(t.adminToken))
          .expect(200)
      ).body,
    ).toEqual([]);
    expect(
      (
        await t.http
          .get('/api/stats/overview')
          .set(auth(t.adminToken))
          .expect(200)
      ).body.attendanceToCheck,
    ).toBe(0);
    // The makeup choice gives no credit.
    const credits = await pool.query(
      'select count(*)::int as n from lesson_credits where lesson_id = $1',
      [lessons[2].id],
    );
    expect(credits.rows[0].n).toBe(0);
  });

  it('keeps the makeup owed until staff book it', async () => {
    const { http } = t;
    expect(await lesson(lessons[2].id)).toMatchObject({ makeupOwed: true });
    expect(
      (
        await http
          .get('/api/stats/overview')
          .set(auth(t.adminToken))
          .expect(200)
      ).body.makeupsOwed,
    ).toBe(1);
    const owed = (
      await http
        .get(`/api/lessons/makeups-owed?studentId=${school.students[0].id}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body as LessonView[];
    expect(owed.map((l) => l.id)).toEqual([lessons[2].id]);
    await http
      .get('/api/lessons/makeups-owed')
      .set(auth(teacherToken))
      .expect(403);

    const subscriptionId = (
      await http
        .get(`/api/students/${school.students[0].id}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body.subscriptions[0].id;
    const startsAt = DateTime.fromISO(lessons[7].startsAt)
      .plus({ days: 1 })
      .toISO();
    // Only a makeup replaces a lesson.
    await http
      .post('/api/lessons/extra')
      .set(auth(t.adminToken))
      .send({
        subscriptionId,
        startsAt,
        extraReason: 'OTHER',
        forLessonId: lessons[2].id,
      })
      .expect(400);
    const makeup = (
      await http
        .post('/api/lessons/extra')
        .set(auth(t.adminToken))
        .send({
          subscriptionId,
          startsAt,
          extraReason: 'MAKEUP',
          forLessonId: lessons[2].id,
        })
        .expect(201)
    ).body;
    expect(makeup).toMatchObject({
      originLessonId: lessons[2].id,
      extraReason: 'MAKEUP',
      billing: null,
    });
    expect(await lesson(lessons[2].id)).toMatchObject({ makeupOwed: false });
    expect(
      (
        await http
          .get('/api/lessons/makeups-owed')
          .set(auth(t.adminToken))
          .expect(200)
      ).body,
    ).toEqual([]);
    // Not twice.
    const later = DateTime.fromISO(lessons[7].startsAt)
      .plus({ days: 2 })
      .toISO();
    await http
      .post('/api/lessons/extra')
      .set(auth(t.adminToken))
      .send({
        subscriptionId,
        startsAt: later,
        extraReason: 'MAKEUP',
        forLessonId: lessons[2].id,
      })
      .expect(409);

    // One lesson with another teacher (a stand-in): theirs to teach and be paid for.
    const standIn = (
      await http
        .post('/api/teachers')
        .set(auth(t.adminToken))
        .send({
          email: 'standin.att@test.local',
          fullName: 'Stand In',
          password: PASSWORD,
          level: 'STANDARD',
          curriculumIds: [school.curriculumId],
        })
        .expect(201)
    ).body;
    await http
      .put(`/api/teachers/${standIn.id}/availability`)
      .set(auth(t.adminToken))
      .send({
        windows: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
          weekday,
          startMinute: 0,
          endMinute: 1440,
        })),
      })
      .expect(200);
    const withOther = (
      await http
        .post('/api/lessons/extra')
        .set(auth(t.adminToken))
        .send({
          subscriptionId,
          startsAt: DateTime.fromISO(lessons[7].startsAt)
            .plus({ days: 3 })
            .toISO(),
          extraReason: 'OTHER',
          teacherId: standIn.id,
        })
        .expect(201)
    ).body;
    expect(withOther).toMatchObject({
      teacherId: standIn.id,
      curriculumId: school.curriculumId,
      type: 'EXTRA',
    });
    const logged = (
      await http
        .get('/api/audit-logs?action=lesson.extra')
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    const items = Array.isArray(logged) ? logged : logged.items;
    expect(items[0].summary).toContain('with Stand In');

    // Each page shows its own log: the student's, the stand-in's, or one kind of action.
    const log = async (query: string) =>
      (
        await http
          .get(`/api/audit-logs?${query}`)
          .set(auth(t.adminToken))
          .expect(200)
      ).body as { action: string; summary: string }[];
    const theirs = await log(`studentId=${school.students[0].id}`);
    expect(theirs.map((e) => e.action)).toEqual(
      expect.arrayContaining(['lesson.extra', 'subscription.create']),
    );
    const standIns = await log(`teacherId=${standIn.id}`);
    expect(standIns.map((e) => e.action)).toEqual(
      expect.arrayContaining([
        'teacher.create',
        'teacher.availability',
        'lesson.extra',
      ]),
    );
    expect(standIns.some((e) => e.action === 'subscription.create')).toBe(
      false,
    );
    const extras = await log('actions=lesson.,homework.');
    expect(extras.length).toBeGreaterThan(0);
    expect(extras.every((e) => /^(lesson|homework)\./.test(e.action))).toBe(
      true,
    );
    await http
      .get('/api/audit-logs?actions=lesson.%25')
      .set(auth(t.adminToken))
      .expect(400);
  });

  it('counts paid and unpaid lessons per teacher, and the pay for admins only', async () => {
    const day = (iso: string) =>
      DateTime.fromISO(iso).setZone('Africa/Cairo').toISODate()!;
    const from = day(lessons[0].startsAt);
    const to = day(lessons[7].startsAt);
    const url = `/api/stats/teacher-lessons?from=${from}&to=${to}`;
    const counts = {
      teacherId: school.teacher.id,
      name: 'Teacher att',
      held: 1,
      studentAbsent: 1,
      paid: 2,
      paidMinutes: lessons[0].durationMin * 2,
      notPaid: 2,
      toCheck: 0,
    };
    // No rate yet: the amount is unknown.
    expect(
      (await t.http.get(url).set(auth(t.adminToken)).expect(200)).body,
    ).toEqual([
      { ...counts, rateCents: null, currency: 'EGP', payCents: null },
    ]);

    // 200 EGP an hour; two paid hour-long lessons = 400 EGP.
    await t.http
      .patch(`/api/teachers/${school.teacher.id}`)
      .set(auth(t.adminToken))
      .send({ hourlyRateCents: 20000, rateCurrency: 'egp' })
      .expect(200);
    expect(
      (await t.http.get(url).set(auth(t.adminToken)).expect(200)).body,
    ).toEqual([
      { ...counts, rateCents: 20000, currency: 'EGP', payCents: 40000 },
    ]);

    // Staff see the counts, never the money, and cannot set it.
    await t.http
      .post('/api/staff')
      .set(auth(t.adminToken))
      .send({
        email: 'staff.att@test.local',
        fullName: 'Staff',
        password: 'Test-password-1',
        role: 'STAFF',
      })
      .expect(201);
    const staffToken = await t.login('staff.att@test.local');
    expect(
      (await t.http.get(url).set(auth(staffToken)).expect(200)).body,
    ).toEqual([counts]);
    await t.http
      .patch(`/api/teachers/${school.teacher.id}`)
      .set(auth(staffToken))
      .send({ hourlyRateCents: 1 })
      .expect(403);
    const seenByStaff = (
      await t.http
        .get(`/api/teachers/${school.teacher.id}`)
        .set(auth(staffToken))
        .expect(200)
    ).body;
    expect(seenByStaff).not.toHaveProperty('hourlyRateCents');
    expect(
      (
        await t.http
          .get(`/api/teachers/${school.teacher.id}`)
          .set(auth(t.adminToken))
          .expect(200)
      ).body,
    ).toMatchObject({ hourlyRateCents: 20000, rateCurrency: 'EGP' });
    // The log says the rate changed, without the amount.
    const logs = (
      await t.http
        .get(`/api/audit-logs?entityId=${school.teacher.id}`)
        .set(auth(staffToken))
        .expect(200)
    ).body;
    expect(logs[0].summary).toContain('pay rate changed');
    expect(JSON.stringify(logs)).not.toContain('20000');

    await t.http
      .get(`/api/stats/teacher-lessons?from=${to}&to=${from}`)
      .set(auth(t.adminToken))
      .expect(from === to ? 200 : 400);
    await t.http.get(url).set(auth(teacherToken)).expect(403);
  });

  it('logs the settling (by the system) and every check (by the person)', async () => {
    const logs = (
      await t.http
        .get('/api/audit-logs?entityType=lesson&limit=200')
        .set(auth(t.adminToken))
        .expect(200)
    ).body as { action: string; actorKind: string; note: string | null }[];
    const settled = logs.filter((l) => l.action === 'lesson.attendance');
    expect(settled).toHaveLength(3);
    expect(settled.every((l) => l.actorKind === 'SYSTEM')).toBe(true);
    const checked = logs.filter((l) => l.action === 'lesson.review');
    expect(checked).toHaveLength(3);
    expect(checked.some((l) => l.note === 'Teacher was ill.')).toBe(true);
  });

  it('adds the lessons column for attendance and pay to the CSV', async () => {
    const day = (iso: string) =>
      DateTime.fromISO(iso).setZone('Africa/Cairo').toISODate()!;
    const res = await t.http
      .get(
        `/api/exports/lessons.csv?from=${day(lessons[0].startsAt)}&to=${day(lessons[3].startsAt)}`,
      )
      .set(auth(t.adminToken))
      .expect(200);
    const [head, ...rows] = res.text.replace(/^﻿/, '').trim().split('\r\n');
    const cols = head.split(',');
    const att = cols.indexOf('Attendance');
    const paid = cols.indexOf('Teacher paid');
    expect(att).toBeGreaterThan(0);
    expect(rows.map((r) => [r.split(',')[att], r.split(',')[paid]])).toEqual([
      ['both entered', 'yes'],
      ['student absent', 'yes'],
      ['teacher did not enter', 'no'],
      ['nobody entered', 'no'],
    ]);
  });

  describe('extra lessons', () => {
    let billing: School;
    let subscriptionId: string;
    let studentId: string;

    const invoicesOf = async () =>
      (
        (
          await t.http
            .get(`/api/invoices?studentId=${studentId}`)
            .set(auth(t.adminToken))
            .expect(200)
        ).body as {
          id: string;
          number: string;
          status: string;
          cycleIndex: number;
          cycleEnd: string;
          extraCount: number;
          billedLessons: number;
          totalCents: number;
          priceCents: number;
        }[]
      ).sort((a, b) => a.cycleIndex - b.cycleIndex);
    const addExtra = (days: number, extraReason: 'OTHER' | 'MAKEUP') =>
      t.http
        .post('/api/lessons/extra')
        .set(auth(t.adminToken))
        .send({
          subscriptionId,
          startsAt: DateTime.now()
            .setZone('America/New_York')
            .plus({ days })
            .set({ hour: 17, minute: 0, second: 0, millisecond: 0 })
            .toISO(),
          extraReason,
        })
        .expect(201);

    beforeAll(async () => {
      billing = await setUpSchool(t, 1, 'ext');
      studentId = billing.students[0].id;
      subscriptionId = (
        await t.http
          .get(`/api/students/${studentId}`)
          .set(auth(t.adminToken))
          .expect(200)
      ).body.subscriptions[0].id;
    });

    it('goes on the current invoice while it is unpaid', async () => {
      const [before] = await invoicesOf();
      const added = (await addExtra(3, 'OTHER')).body;
      expect(added.billing).toEqual({
        invoiceNumber: before.number,
        pending: false,
      });
      const [after] = await invoicesOf();
      expect(after).toMatchObject({
        extraCount: 1,
        billedLessons: before.billedLessons + 1,
        totalCents: before.totalCents + before.priceCents,
      });
      const detail = (
        await t.http
          .get(`/api/invoices/${after.id}`)
          .set(auth(t.adminToken))
          .expect(200)
      ).body;
      expect(detail.extraCount).toBe(1);
      expect(detail.extras).toHaveLength(1);
    });

    it('a makeup lesson is not billed', async () => {
      const [before] = await invoicesOf();
      expect((await addExtra(4, 'MAKEUP')).body.billing).toBeNull();
      const [after] = await invoicesOf();
      expect(after.totalCents).toBe(before.totalCents);
    });

    it('goes on the next invoice once the current one is paid', async () => {
      const [first] = await invoicesOf();
      await t.http
        .post(`/api/invoices/${first.id}/pay`)
        .set(auth(t.adminToken))
        .expect(200);
      expect((await addExtra(5, 'OTHER')).body.billing).toEqual({
        invoiceNumber: null,
        pending: true,
      });
      // The paid invoice stays as it was.
      expect((await invoicesOf())[0]).toMatchObject({
        status: 'PAID',
        extraCount: 1,
        totalCents: first.totalCents,
      });

      // The last day of the cycle opens the next one, with the extra lesson on it.
      const lastDay = DateTime.fromISO(first.cycleEnd, {
        zone: 'America/New_York',
      })
        .set({ hour: 12 })
        .toJSDate();
      expect(
        await t.app.get(CyclesService).rollover(lastDay),
      ).toBeGreaterThanOrEqual(1);
      const second = (await invoicesOf()).find((i) => i.cycleIndex === 2)!;
      expect(second).toMatchObject({
        extraCount: 1,
        billedLessons: 9,
        totalCents: 9 * second.priceCents,
      });
      const detail = (
        await t.http
          .get(`/api/invoices/${second.id}`)
          .set(auth(t.adminToken))
          .expect(200)
      ).body;
      expect(detail.extras).toHaveLength(1);
      // Applied once only.
      // (Another student's charge waits: their cycle is unpaid, so no new one opens.)
      const pending = await pool.query(
        `select count(*)::int as n from lesson_charges where status = 'PENDING' and student_id = $1`,
        [studentId],
      );
      expect(pending.rows[0].n).toBe(0);
    });

    it("suggests the teacher's free times for a new lesson, on the student's clock", async () => {
      const date = DateTime.now()
        .setZone('America/New_York')
        .plus({ days: 8 })
        .toISODate()!;
      const url = `/api/subscriptions/${subscriptionId}/free-slots?date=${date}`;
      const before = (await t.http.get(url).set(auth(t.adminToken)).expect(200))
        .body as {
        timezone: string;
        durationMin: number;
        slots: { startsAt: string; local: string; cairo: string }[];
      };
      expect(before).toMatchObject({
        timezone: 'America/New_York',
        durationMin: 60,
      });
      // Free all day, half-hour steps; the day's own lesson (if any) blocks its time.
      expect(before.slots.length).toBeGreaterThan(30);
      expect(before.slots[0].local).toMatch(/^\d{1,2}:\d{2} [AP]M$/);

      const pick = before.slots[6].startsAt;
      await t.http
        .post('/api/lessons/extra')
        .set(auth(t.adminToken))
        .send({ subscriptionId, startsAt: pick, extraReason: 'MAKEUP' })
        .expect(201);
      const after = (await t.http.get(url).set(auth(t.adminToken)).expect(200))
        .body as typeof before;
      const taken = new Date(pick).getTime();
      // Nothing that would overlap the new hour-long lesson is offered.
      expect(
        after.slots.filter(
          (s) => Math.abs(new Date(s.startsAt).getTime() - taken) < 60 * 60_000,
        ),
      ).toHaveLength(0);

      await t.http.get(url).set(auth(studentToken)).expect(403);
      await t.http
        .get(`/api/subscriptions/${subscriptionId}/free-slots?date=tomorrow`)
        .set(auth(t.adminToken))
        .expect(400);
    });
  });
});
