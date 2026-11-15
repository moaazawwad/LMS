/**
 * Who can see and change what. Two separate "schools" (a teacher and a
 * student each) so every check is "my own" vs "somebody else's".
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

type Who =
  | 'anon'
  | 'studentA'
  | 'studentB'
  | 'teacherA'
  | 'teacherB'
  | 'staff'
  | 'admin';
type Method = 'get' | 'post' | 'patch' | 'put';

interface Ctx {
  a: School;
  b: School;
  lessonA: string;
  studentAUserId: string;
  adminUserId: string;
  subscriptionA: string;
  invoiceA: string;
  requestA: string;
  dateA: string;
}

interface Case {
  name: string;
  method: Method;
  path: (c: Ctx) => string;
  body?: (c: Ctx) => object;
  expect: Partial<Record<Who, number>>;
}

const cases: Case[] = [
  // lessons
  {
    name: 'read a lesson',
    method: 'get',
    path: (c) => `/api/lessons/${c.lessonA}`,
    expect: {
      anon: 401,
      studentA: 200,
      studentB: 403,
      teacherA: 200,
      teacherB: 403,
      staff: 200,
    },
  },
  {
    name: 'free times for a lesson',
    method: 'get',
    path: (c) => `/api/lessons/${c.lessonA}/free-slots?date=${c.dateA}`,
    expect: { studentA: 200, studentB: 403, teacherA: 403, staff: 200 },
  },
  {
    name: 'enter someone else’s class',
    method: 'post',
    path: (c) => `/api/lessons/${c.lessonA}/enter`,
    expect: { studentB: 403, teacherB: 403 },
  },
  {
    name: 'a teacher cancelling directly (they ask the academy)',
    method: 'post',
    path: (c) => `/api/lessons/${c.lessonA}/cancel`,
    body: () => ({}),
    expect: { teacherA: 403 },
  },
  {
    name: 'cancel someone else’s lesson',
    method: 'post',
    path: (c) => `/api/lessons/${c.lessonA}/cancel`,
    body: () => ({}),
    expect: { studentB: 403, teacherB: 403 },
  },
  {
    name: 'move someone else’s lesson',
    method: 'post',
    path: (c) => `/api/lessons/${c.lessonA}/reschedule`,
    body: () => ({ startsAt: DateTime.now().plus({ days: 3 }).toISO() }),
    expect: { studentB: 403, teacherB: 403 },
  },
  {
    name: 'write lesson notes',
    method: 'patch',
    path: (c) => `/api/lessons/${c.lessonA}/notes`,
    body: () => ({ notes: 'x' }),
    expect: { studentA: 403, teacherB: 403, teacherA: 200 },
  },
  {
    name: 'transfer a lesson',
    method: 'post',
    path: (c) => `/api/lessons/${c.lessonA}/transfer`,
    body: (c) => ({ teacherId: c.b.teacher.id }),
    expect: { studentA: 403, teacherA: 403 },
  },
  {
    name: 'lessons whose attendance needs checking',
    method: 'get',
    path: () => '/api/lessons/attendance-review',
    expect: { studentA: 403, teacherA: 403, staff: 200 },
  },
  {
    name: 'record what happened in a lesson',
    method: 'post',
    path: (c) => `/api/lessons/${c.lessonA}/attendance`,
    body: () => ({ outcome: 'HELD' }),
    expect: { studentA: 403, teacherA: 403, teacherB: 403 },
  },
  {
    name: 'look ahead for lessons outside hours or clashing',
    method: 'get',
    path: () => '/api/lessons/schedule-check',
    expect: { studentA: 403, teacherA: 403, staff: 200 },
  },
  {
    name: 'makeups still owed',
    method: 'get',
    path: () => '/api/lessons/makeups-owed',
    expect: { studentA: 403, teacherA: 403, staff: 200 },
  },
  {
    name: 'lessons per teacher, for pay',
    method: 'get',
    path: (c) => `/api/stats/teacher-lessons?from=${c.dateA}&to=${c.dateA}`,
    expect: { studentA: 403, teacherA: 403, staff: 200 },
  },
  {
    name: 'add an extra lesson',
    method: 'post',
    path: () => '/api/lessons/extra',
    body: (c) => ({
      subscriptionId: c.subscriptionA,
      startsAt: DateTime.now().plus({ days: 3 }).toISO(),
    }),
    expect: { studentA: 403, teacherA: 403 },
  },

  // students
  {
    name: 'list students',
    method: 'get',
    path: () => '/api/students',
    expect: { anon: 401, studentA: 403, teacherA: 403, staff: 200 },
  },
  {
    name: 'read a student',
    method: 'get',
    path: (c) => `/api/students/${c.a.students[0].id}`,
    expect: { studentA: 200, studentB: 403, teacherA: 403, staff: 200 },
  },
  {
    name: 'read a student’s overview',
    method: 'get',
    path: (c) => `/api/students/${c.a.students[0].id}/overview`,
    expect: { studentA: 200, studentB: 403, teacherA: 403 },
  },
  {
    name: 'edit a student',
    method: 'patch',
    path: (c) => `/api/students/${c.a.students[0].id}`,
    body: () => ({ fullName: 'Hacked' }),
    expect: { studentA: 403, teacherA: 403 },
  },
  {
    name: 'add a student',
    method: 'post',
    path: () => '/api/students',
    body: () => ({
      email: 'x@test.local',
      fullName: 'X',
      password: PASSWORD,
      timezone: 'UTC',
    }),
    expect: { studentA: 403, teacherA: 403 },
  },

  // teachers
  {
    name: 'list teachers',
    method: 'get',
    path: () => '/api/teachers',
    expect: { studentA: 403, teacherA: 403, staff: 200 },
  },
  {
    name: 'read a teacher',
    method: 'get',
    path: (c) => `/api/teachers/${c.a.teacher.id}`,
    expect: { teacherA: 200, teacherB: 403, studentA: 403, staff: 200 },
  },
  {
    name: 'change a teacher’s level',
    method: 'patch',
    path: (c) => `/api/teachers/${c.a.teacher.id}`,
    body: () => ({ level: 'PREMIUM' }),
    expect: { teacherA: 403, studentA: 403 },
  },
  {
    name: 'a teacher’s free weekly times',
    method: 'get',
    path: (c) =>
      `/api/teachers/${c.a.teacher.id}/weekly-free?timezone=America/New_York&startDate=${c.dateA}`,
    expect: { staff: 200, teacherA: 403, studentA: 403 },
  },
  {
    name: 'change a teacher’s hours',
    method: 'put',
    path: (c) => `/api/teachers/${c.a.teacher.id}/availability`,
    body: () => ({ windows: [] }),
    expect: { teacherA: 403 },
  },

  // subscriptions and invoices
  {
    name: 'read a subscription',
    method: 'get',
    path: (c) => `/api/subscriptions/${c.subscriptionA}`,
    expect: { studentA: 403, teacherA: 403, staff: 200 },
  },
  {
    name: 'pause a subscription',
    method: 'post',
    path: (c) => `/api/subscriptions/${c.subscriptionA}/pause`,
    body: () => ({}),
    expect: { studentA: 403, teacherA: 403 },
  },
  {
    name: 'list invoices',
    method: 'get',
    path: () => '/api/invoices',
    expect: { studentA: 200, teacherA: 403, staff: 200 },
  },
  {
    name: 'read an invoice',
    method: 'get',
    path: (c) => `/api/invoices/${c.invoiceA}`,
    expect: { studentA: 200, studentB: 404, teacherA: 404, staff: 200 },
  },
  {
    name: 'mark an invoice paid',
    method: 'post',
    path: (c) => `/api/invoices/${c.invoiceA}/pay`,
    expect: { studentA: 403, teacherA: 403 },
  },
  {
    name: 'void an invoice',
    method: 'post',
    path: (c) => `/api/invoices/${c.invoiceA}/void`,
    body: () => ({}),
    expect: { staff: 403, studentA: 403 },
  },

  // catalog, staff, logs
  {
    name: 'add a plan',
    method: 'post',
    path: () => '/api/plans',
    body: () => ({
      name: 'Free',
      tier: 'BASIC',
      priceCents: 0,
      cancelQuota: 1,
      rescheduleQuota: 1,
    }),
    expect: { staff: 403, teacherA: 403, studentA: 403 },
  },
  {
    name: 'add a curriculum',
    method: 'post',
    path: () => '/api/curricula',
    body: () => ({ name: 'Hack 1' }),
    expect: { teacherA: 403, studentA: 403 },
  },
  {
    name: 'academy numbers',
    method: 'get',
    path: () => '/api/stats/overview',
    expect: { staff: 200, admin: 200, teacherA: 403, studentA: 403 },
  },
  {
    name: 'download lessons as CSV',
    method: 'get',
    path: (c) => `/api/exports/lessons.csv?from=${c.dateA}&to=${c.dateA}`,
    expect: { staff: 200, teacherA: 403, studentA: 403, anon: 401 },
  },
  {
    name: 'download invoices as CSV',
    method: 'get',
    path: (c) => `/api/exports/invoices.csv?from=${c.dateA}&to=${c.dateA}`,
    expect: { admin: 200, teacherA: 403, studentA: 403 },
  },
  {
    name: 'read the activity log',
    method: 'get',
    path: () => '/api/audit-logs',
    expect: { anon: 401, studentA: 403, teacherA: 403, staff: 200 },
  },
  {
    name: 'list staff',
    method: 'get',
    path: () => '/api/staff',
    expect: { staff: 403, teacherA: 403, studentA: 403, admin: 200 },
  },
  {
    name: 'reset an admin’s password',
    method: 'post',
    path: (c) => `/api/users/${c.adminUserId}/password`,
    body: () => ({ newPassword: 'Taken-over-1' }),
    expect: { staff: 403, studentA: 403, teacherA: 403 },
  },
  {
    name: 'turn off someone’s sign-in',
    method: 'post',
    path: (c) => `/api/users/${c.studentAUserId}/active`,
    body: () => ({ isActive: true }),
    expect: { teacherA: 403, studentB: 403, staff: 200 },
  },

  // requests
  {
    name: 'ask about someone else’s lesson',
    method: 'post',
    path: () => '/api/requests',
    body: (c) => ({ lessonId: c.lessonA, kind: 'CANCEL', message: 'x' }),
    expect: { studentB: 404, teacherB: 404 },
  },
  {
    name: 'approve a request',
    method: 'post',
    path: (c) => `/api/requests/${c.requestA}/approve`,
    body: () => ({}),
    expect: { studentA: 403, teacherA: 403 },
  },
  {
    name: 'decline a request',
    method: 'post',
    path: (c) => `/api/requests/${c.requestA}/decline`,
    body: () => ({ note: 'no' }),
    expect: { studentA: 403, teacherA: 403 },
  },
  {
    name: 'withdraw someone else’s request',
    method: 'post',
    path: (c) => `/api/requests/${c.requestA}/withdraw`,
    expect: { studentB: 404, teacherA: 404 },
  },

  // input checks
  {
    name: 'a second plan for the same level',
    method: 'post',
    path: () => '/api/plans',
    body: () => ({
      name: 'Standard 2',
      tier: 'STANDARD',
      priceCents: 1,
      cancelQuota: 1,
      rescheduleQuota: 1,
    }),
    expect: { admin: 409 },
  },
  {
    name: 'a malformed id',
    method: 'get',
    path: () => '/api/lessons/not-a-uuid',
    expect: { studentA: 400, staff: 400 },
  },
  {
    name: 'give yourself a role through the profile',
    method: 'patch',
    path: () => '/api/auth/me',
    body: () => ({ role: 'ADMIN' }),
    expect: { studentA: 400, teacherA: 400 },
  },
];

suite('access control (e2e)', () => {
  let t: TestApp;
  const tokens: Partial<Record<Who, string>> = {};
  const ctx = {} as Ctx;

  beforeAll(async () => {
    t = await startApp();
    const { http, adminToken } = t;
    ctx.a = await setUpSchool(t, 1, 'a');
    ctx.b = await setUpSchool(t, 1, 'b');
    await http
      .post('/api/staff')
      .set(auth(adminToken))
      .send({
        email: 'staff@test.local',
        fullName: 'Staff',
        password: PASSWORD,
        role: 'STAFF',
      })
      .expect(201);

    tokens.admin = adminToken;
    tokens.staff = await t.login('staff@test.local');
    tokens.studentA = await t.login(ctx.a.students[0].email);
    tokens.studentB = await t.login(ctx.b.students[0].email);
    tokens.teacherA = await t.login(ctx.a.teacher.email);
    tokens.teacherB = await t.login(ctx.b.teacher.email);

    ctx.lessonA = ctx.a.students[0].lessonIds[0];
    const studentA = (
      await http
        .get(`/api/students/${ctx.a.students[0].id}`)
        .set(auth(adminToken))
        .expect(200)
    ).body;
    ctx.studentAUserId = studentA.userId;
    ctx.subscriptionA = studentA.subscriptions[0].id;
    ctx.invoiceA = (
      await http
        .get(`/api/invoices?studentId=${ctx.a.students[0].id}`)
        .set(auth(adminToken))
        .expect(200)
    ).body[0].id;
    ctx.adminUserId = (
      await http.get('/api/auth/me').set(auth(adminToken)).expect(200)
    ).body.userId;
    const lesson = (
      await http
        .get(`/api/lessons/${ctx.lessonA}`)
        .set(auth(adminToken))
        .expect(200)
    ).body;
    ctx.dateA = DateTime.fromISO(lesson.startsAt)
      .setZone('America/New_York')
      .plus({ days: 1 })
      .toISODate()!;
    ctx.requestA = (
      await http
        .post('/api/requests')
        .set(auth(tokens.studentA))
        .send({
          lessonId: ctx.a.students[0].lessonIds[5],
          kind: 'CANCEL',
          message: 'Please.',
        })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await t?.app.close();
  });

  const rows = cases.flatMap((c) =>
    Object.entries(c.expect).map(([who, status]) => ({
      ...c,
      who: who as Who,
      status: status!,
    })),
  );

  it.each(rows)(
    '$who: $name → $status',
    async ({ method, path, body, who, status }) => {
      let req = t.http[method](path(ctx));
      if (who !== 'anon') req = req.set(auth(tokens[who]!));
      if (body) req = req.send(body(ctx));
      const res = await req;
      expect(res.status, JSON.stringify(res.body)).toBe(status);
    },
  );

  it('only lists a person’s own lessons and invoices', async () => {
    const { http } = t;
    const lessonsB = (
      await http.get('/api/lessons').set(auth(tokens.studentB!)).expect(200)
    ).body as { id: string }[];
    expect(lessonsB.map((l) => l.id)).not.toContain(ctx.lessonA);
    const teacherB = (
      await http.get('/api/lessons').set(auth(tokens.teacherB!)).expect(200)
    ).body as { id: string }[];
    expect(teacherB.map((l) => l.id)).not.toContain(ctx.lessonA);
    // A student can't widen the list with someone else's id.
    const sneaky = (
      await http
        .get(`/api/lessons?studentId=${ctx.a.students[0].id}`)
        .set(auth(tokens.studentB!))
        .expect(200)
    ).body as {
      id: string;
    }[];
    expect(sneaky.map((l) => l.id)).not.toContain(ctx.lessonA);
    const invoicesB = (
      await http
        .get(`/api/invoices?studentId=${ctx.a.students[0].id}`)
        .set(auth(tokens.studentB!))
        .expect(200)
    ).body as {
      id: string;
    }[];
    expect(invoicesB.map((i) => i.id)).not.toContain(ctx.invoiceA);
    const requestsB = (
      await http.get('/api/requests').set(auth(tokens.studentB!)).expect(200)
    ).body;
    expect(requestsB).toEqual([]);
  });

  it('refuses a tampered token', async () => {
    const token = tokens.studentA!;
    const tampered = token.slice(0, -2) + (token.endsWith('A') ? 'BB' : 'AA');
    await t.http.get('/api/lessons').set(auth(tampered)).expect(401);
    // A token whose payload claims ADMIN but keeps the old signature.
    const [h, p, s] = token.split('.');
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    const forged = [
      h,
      Buffer.from(JSON.stringify({ ...payload, role: 'ADMIN' })).toString(
        'base64url',
      ),
      s,
    ].join('.');
    await t.http.get('/api/students').set(auth(forged)).expect(401);
  });

  it('pauses sign-in after 5 wrong passwords, even with the right one, and logs it', async () => {
    const { http } = t;
    await http
      .post('/api/students')
      .set(auth(t.adminToken))
      .send({
        email: 'guess@test.local',
        fullName: 'Guess Me',
        password: PASSWORD,
        timezone: 'UTC',
      })
      .expect(201);
    for (let i = 0; i < 5; i++) {
      await http
        .post('/api/auth/login')
        .send({ email: 'guess@test.local', password: `wrong-${i}` })
        .expect(401);
    }
    const locked = await http
      .post('/api/auth/login')
      .send({ email: 'guess@test.local', password: PASSWORD })
      .expect(429);
    expect(locked.body.message).toMatch(/Try again in \d+ minutes?/);
    const logs = (
      await http
        .get('/api/audit-logs?entityType=user')
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    expect(
      logs.find((l: { action: string }) => l.action === 'auth.locked'),
    ).toMatchObject({ entityId: 'guess@test.local' });
  });

  it('answers an unknown email and a wrong password the same way', async () => {
    const unknown = await t.http
      .post('/api/auth/login')
      .send({ email: 'nobody@test.local', password: 'whatever-1' })
      .expect(401);
    const wrong = await t.http
      .post('/api/auth/login')
      .send({ email: 'admin@test.local', password: 'whatever-1' })
      .expect(401);
    expect(unknown.body.message).toBe(wrong.body.message);
  });

  it('sends security headers', async () => {
    const res = await t.http.get('/api/health').expect(200);
    expect(res.headers['content-security-policy']).toContain(
      "default-src 'self'",
    );
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
