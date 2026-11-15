/**
 * Requests: a student or teacher asks; staff approve (the change happens in
 * the same step) or decline. WIPES the database at TEST_DATABASE_URL.
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

suite('change requests (e2e)', () => {
  let t: TestApp;
  let school: School;
  let studentToken: string;
  let teacherToken: string;
  let lessons: string[];

  beforeAll(async () => {
    t = await startApp();
    school = await setUpSchool(t, 1, 'req');
    studentToken = await t.login(school.students[0].email);
    teacherToken = await t.login(school.teacher.email);
    lessons = school.students[0].lessonIds;
  });

  afterAll(async () => {
    await t?.app.close();
  });

  it('lets a student ask once the online cancels are used up', async () => {
    const { http } = t;
    await http
      .post(`/api/lessons/${lessons[0]}/cancel`)
      .set(auth(studentToken))
      .send({})
      .expect(200);
    await http
      .post(`/api/lessons/${lessons[1]}/cancel`)
      .set(auth(studentToken))
      .send({})
      .expect(200);
    await http
      .post(`/api/lessons/${lessons[2]}/cancel`)
      .set(auth(studentToken))
      .send({})
      .expect(422);

    const created = await http
      .post('/api/requests')
      .set(auth(studentToken))
      .send({
        lessonId: lessons[2],
        kind: 'CANCEL',
        message: 'Family emergency, sorry.',
      })
      .expect(201);
    expect(created.body).toMatchObject({
      status: 'OPEN',
      kind: 'CANCEL',
      requesterKind: 'STUDENT',
    });

    // One open request per lesson.
    await http
      .post('/api/requests')
      .set(auth(studentToken))
      .send({
        lessonId: lessons[2],
        kind: 'RESCHEDULE',
        message: 'Or move it?',
      })
      .expect(409);
    // Staff change lessons directly, they don't ask.
    await http
      .post('/api/requests')
      .set(auth(t.adminToken))
      .send({ lessonId: lessons[2], kind: 'CANCEL', message: 'x' })
      .expect(403);
    // An empty message is refused.
    await http
      .post('/api/requests')
      .set(auth(studentToken))
      .send({ lessonId: lessons[3], kind: 'CANCEL', message: '' })
      .expect(400);
  });

  it('shows staff why the student could not do it online', async () => {
    const { http } = t;
    const open = (
      await http
        .get('/api/requests?status=OPEN')
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    expect(open).toHaveLength(1);
    expect(open[0].rules.map((r: { code: string }) => r.code)).toContain(
      'QUOTA_EXHAUSTED',
    );
    expect(open[0].lesson.id).toBe(lessons[2]);
    expect(open[0].requester.kind).toBe('STUDENT');
    expect(
      (
        await http
          .get('/api/requests/summary')
          .set(auth(t.adminToken))
          .expect(200)
      ).body,
    ).toEqual({ open: 1 });

    // The student sees their own request, without the staff-only rule details.
    const mine = (
      await http.get('/api/requests').set(auth(studentToken)).expect(200)
    ).body;
    expect(mine).toHaveLength(1);
    expect(mine[0].rules).toEqual([]);
    // The teacher did not ask anything.
    expect(
      (await http.get('/api/requests').set(auth(teacherToken)).expect(200))
        .body,
    ).toHaveLength(0);
  });

  it('approves a late cancel as "counts as taken", and only once', async () => {
    const { http } = t;
    const [req] = (
      await http
        .get('/api/requests?status=OPEN')
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    await http
      .post(`/api/requests/${req.id}/approve`)
      .set(auth(studentToken))
      .send({})
      .expect(403);

    const approved = await http
      .post(`/api/requests/${req.id}/approve`)
      .set(auth(t.adminToken))
      .send({ credit: false, note: 'Counted, as per the plan.' })
      .expect(200);
    expect(approved.body).toMatchObject({
      status: 'APPROVED',
      resolutionNote: 'Counted, as per the plan.',
    });

    const lesson = (
      await http
        .get(`/api/lessons/${lessons[2]}`)
        .set(auth(studentToken))
        .expect(200)
    ).body;
    expect(lesson).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'BY_STUDENT',
      countedAsTaken: true,
    });
    await http
      .post(`/api/requests/${req.id}/approve`)
      .set(auth(t.adminToken))
      .send({})
      .expect(409);
  });

  it('approves a move at a time staff pick, refusing a clash unless they override', async () => {
    const { http } = t;
    const req = (
      await http
        .post('/api/requests')
        .set(auth(studentToken))
        .send({
          lessonId: lessons[3],
          kind: 'RESCHEDULE',
          message: 'Exam that day.',
          preferredTimes: 'Any evening',
        })
        .expect(201)
    ).body;
    expect(req.preferredTimes).toBe('Any evening');

    // Another of the student's lessons is a clash.
    const other = (
      await http
        .get(`/api/lessons/${lessons[4]}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    const clash = await http
      .post(`/api/requests/${req.id}/approve`)
      .set(auth(t.adminToken))
      .send({ startsAt: other.startsAt })
      .expect(422);
    expect(clash.body).toMatchObject({ canOverride: true });

    const current = (
      await http
        .get(`/api/lessons/${lessons[3]}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    const evening = DateTime.fromISO(current.startsAt)
      .setZone('America/New_York')
      .set({ hour: 19 })
      .toUTC()
      .toISO();
    const approved = (
      await http
        .post(`/api/requests/${req.id}/approve`)
        .set(auth(t.adminToken))
        .send({ startsAt: evening })
        .expect(200)
    ).body;
    expect(approved.status).toBe('APPROVED');
    expect(approved.resultLessonId).toBeTruthy();

    const moved = (
      await http
        .get(`/api/lessons/${approved.resultLessonId}`)
        .set(auth(studentToken))
        .expect(200)
    ).body;
    expect(moved).toMatchObject({
      type: 'RESCHEDULED',
      originLessonId: lessons[3],
    });
    expect(
      DateTime.fromISO(moved.startsAt).setZone('America/New_York').hour,
    ).toBe(19);
  });

  it('declines a teacher request only with a reason, and the teacher sees it', async () => {
    const { http } = t;
    const req = (
      await http
        .post('/api/requests')
        .set(auth(teacherToken))
        .send({
          lessonId: lessons[5],
          kind: 'CANCEL',
          message: 'Doctor appointment.',
        })
        .expect(201)
    ).body;
    expect(req.requesterKind).toBe('TEACHER');
    await http
      .post(`/api/requests/${req.id}/decline`)
      .set(auth(t.adminToken))
      .send({ note: '' })
      .expect(400);
    await http
      .post(`/api/requests/${req.id}/decline`)
      .set(auth(t.adminToken))
      .send({ note: 'Please swap with Mona instead.' })
      .expect(200);

    const [mine] = (
      await http.get('/api/requests').set(auth(teacherToken)).expect(200)
    ).body;
    expect(mine).toMatchObject({
      status: 'DECLINED',
      resolutionNote: 'Please swap with Mona instead.',
      resolvedBy: 'Admin',
    });
    await http
      .post(`/api/requests/${req.id}/withdraw`)
      .set(auth(teacherToken))
      .expect(409);
  });

  it('approves a teacher cancel as a makeup owed', async () => {
    const { http } = t;
    const req = (
      await http
        .post('/api/requests')
        .set(auth(teacherToken))
        .send({
          lessonId: lessons[5],
          kind: 'CANCEL',
          message: 'Moved my appointment, still cannot make it.',
        })
        .expect(201)
    ).body;
    await http
      .post(`/api/requests/${req.id}/approve`)
      .set(auth(t.adminToken))
      .send({ teacherRemedy: 'MAKEUP' })
      .expect(200);
    const lesson = (
      await http
        .get(`/api/lessons/${lessons[5]}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    expect(lesson).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'BY_TEACHER',
      countedAsTaken: false,
    });
  });

  it('lets only the requester withdraw an open request', async () => {
    const { http } = t;
    const req = (
      await http
        .post('/api/requests')
        .set(auth(studentToken))
        .send({ lessonId: lessons[6], kind: 'CANCEL', message: 'Maybe.' })
        .expect(201)
    ).body;
    await http
      .post(`/api/requests/${req.id}/withdraw`)
      .set(auth(teacherToken))
      .expect(404);
    const done = (
      await http
        .post(`/api/requests/${req.id}/withdraw`)
        .set(auth(studentToken))
        .expect(200)
    ).body;
    expect(done.status).toBe('WITHDRAWN');
    // A withdrawn request no longer blocks a new one.
    await http
      .post('/api/requests')
      .set(auth(studentToken))
      .send({ lessonId: lessons[6], kind: 'CANCEL', message: 'Yes, please.' })
      .expect(201);
  });

  it('logs every step', async () => {
    const logs = (
      await t.http
        .get('/api/audit-logs?entityType=lesson')
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    const actions = logs.map((l: { action: string }) => l.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'request.create',
        'request.approve',
        'request.decline',
        'request.withdraw',
      ]),
    );

    // Text search over the summary and note; % and _ are taken literally.
    const found = (
      await t.http
        .get('/api/audit-logs?q=asked%20to%20move')
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    expect(found.length).toBeGreaterThan(0);
    for (const e of found)
      expect(e.summary.toLowerCase()).toContain('asked to move');
    expect(
      (
        await t.http
          .get('/api/audit-logs?q=%25')
          .set(auth(t.adminToken))
          .expect(200)
      ).body,
    ).toEqual([]);
  });

  it('suggests weekly times that are free every week of the first cycle', async () => {
    const { http } = t;
    const lesson = (
      await http
        .get(`/api/lessons/${lessons[4]}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    const start = DateTime.fromISO(lesson.startsAt)
      .setZone('America/New_York')
      .toISODate();
    const free = (
      await http
        .get(
          `/api/teachers/${school.teacher.id}/weekly-free?timezone=America/New_York&startDate=${start}`,
        )
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    expect(free.days).toHaveLength(7);
    // The teacher works all day; the student's Tue/Thu 9:00 slots are taken, 8:00 and 10:00 are not.
    const tuesday = free.days.find(
      (d: { weekday: number }) => d.weekday === 2,
    ).times;
    expect(tuesday).toContain('08:00');
    expect(tuesday).not.toContain('09:00');
    expect(tuesday).toContain('10:00');
    // Changing that student's own times: their slots don't count against them.
    const sub = (
      await http
        .get(`/api/students/${school.students[0].id}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body.subscriptions[0].id;
    const own = (
      await http
        .get(
          `/api/teachers/${school.teacher.id}/weekly-free?timezone=America/New_York&startDate=${start}&excludeSubscriptionId=${sub}`,
        )
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    expect(
      own.days.find((d: { weekday: number }) => d.weekday === 2).times,
    ).toContain('09:00');
  });

  it('counts the academy at a glance', async () => {
    const { http } = t;
    const stats = (
      await http.get('/api/stats/overview').set(auth(t.adminToken)).expect(200)
    ).body;
    const summary = (
      await http
        .get('/api/requests/summary')
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    expect(stats).toMatchObject({
      activeStudents: 1,
      activeTeachers: 1,
      openRequests: summary.open,
    });
    expect(stats.unpaid[0]).toMatchObject({ currency: 'USD', invoices: 1 });
    expect(stats.unpaid[0].totalCents).toBeGreaterThan(0);
    expect(stats.lessonsNext7Days).toBeGreaterThanOrEqual(0);
  });

  it('exports lessons and invoices as CSV, and logs the download', async () => {
    const { http } = t;
    const from = DateTime.now().setZone('Africa/Cairo').toISODate()!;
    const to = DateTime.now()
      .setZone('Africa/Cairo')
      .plus({ days: 40 })
      .toISODate()!;
    const res = await http
      .get(`/api/exports/lessons.csv?from=${from}&to=${to}`)
      .set(auth(t.adminToken))
      .expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain(
      `lessons_${from}_${to}.csv`,
    );
    const lines = res.text
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n');
    expect(lines[0]).toMatch(/^Starts \(Cairo\),Starts \(student\),/);
    const all = (
      await http
        .get(`/api/lessons?studentId=${school.students[0].id}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    expect(lines.length - 1).toBe(all.length);

    const inv = await http
      .get(`/api/exports/invoices.csv?from=${from}&to=${to}`)
      .set(auth(t.adminToken))
      .expect(200);
    expect(inv.text).toContain('INV-0001');
    await http
      .get(`/api/exports/invoices.csv?from=${to}&to=${from}`)
      .set(auth(t.adminToken))
      .expect(400);

    const logs = (
      await http
        .get('/api/audit-logs?action=export.lessons')
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    expect(logs[0].summary).toMatch(/^Downloaded \d+ lessons/);
  });

  it('lets a student move a lesson past the end of its cycle; it stays on the original invoice', async () => {
    const { http } = t;
    const last = (
      await http
        .get(`/api/lessons/${lessons[7]}`)
        .set(auth(studentToken))
        .expect(200)
    ).body;
    const invoiceId = (
      await http.get('/api/invoices').set(auth(studentToken)).expect(200)
    ).body.find((i: { cycleIndex: number }) => i.cycleIndex === 1).id;
    const before = (
      await http
        .get(`/api/invoices/${invoiceId}`)
        .set(auth(studentToken))
        .expect(200)
    ).body;
    const later = DateTime.fromISO(`${before.cycle.endDate}T12:00`, {
      zone: 'America/New_York',
    }).plus({ days: 3 });

    const moved = (
      await http
        .post(`/api/lessons/${last.id}/reschedule`)
        .set(auth(studentToken))
        .send({ startsAt: later.toUTC().toISO() })
        .expect(201)
    ).body;
    expect(
      DateTime.fromISO(moved.startsAt)
        .setZone('America/New_York')
        .toISODate()! > before.cycle.endDate,
    ).toBe(true);

    const after = (
      await http
        .get(`/api/invoices/${invoiceId}`)
        .set(auth(studentToken))
        .expect(200)
    ).body;
    expect(
      after.lessons.map((l: { startsAt: string }) =>
        new Date(l.startsAt).toISOString(),
      ),
    ).toContain(new Date(moved.startsAt).toISOString());
    expect(after.totalCents).toBe(before.totalCents);
  });
});
