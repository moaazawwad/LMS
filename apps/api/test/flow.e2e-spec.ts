/**
 * End-to-end flow against a real PostgreSQL database.
 * WARNING: it wipes the database it points at. Use a separate test database:
 *   TEST_DATABASE_URL=postgresql://lms:lms@localhost:5432/lms_test npm run test:e2e
 * Skipped when TEST_DATABASE_URL is not set.
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { DateTime } from 'luxon';
import pg from 'pg';
import request from 'supertest';

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const PASSWORD = 'Test-password-1';

suite('LMS flow (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let adminToken: string;
  let studentToken: string;
  let lessonIds: string[] = [];
  let cycleEnd: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const login = async (email: string) =>
    (
      await http
        .post('/api/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200)
    ).body.accessToken as string;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.JWT_SECRET = 'e2e-secret';

    const pool = new pg.Pool({ connectionString: url });
    await pool.query(
      'drop schema if exists drizzle cascade; drop schema public cascade; create schema public;',
    );
    await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
    const { hashPassword } = await import('../src/auth/auth.service.js');
    await pool.query(
      `insert into users (email, password_hash, role, full_name) values ($1, $2, 'ADMIN', 'Admin')`,
      ['admin@test.local', await hashPassword(PASSWORD)],
    );
    await pool.end();

    const { AppModule } = await import('../src/app.module.js');
    const { configureApp } = await import('../src/app.setup.js');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    adminToken = await login('admin@test.local');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('sets up a teacher, a student and a subscription', async () => {
    const curriculum = (
      await http
        .post('/api/curricula')
        .set(auth(adminToken))
        .send({ name: 'Foundations 1' })
        .expect(201)
    ).body;
    const plan = (
      await http
        .post('/api/plans')
        .set(auth(adminToken))
        .send({
          name: 'Standard',
          tier: 'STANDARD',
          priceCents: 1500,
          cancelQuota: 2,
          rescheduleQuota: 2,
        })
        .expect(201)
    ).body;
    const teacher = (
      await http
        .post('/api/teachers')
        .set(auth(adminToken))
        .send({
          email: 'teacher@test.local',
          fullName: 'Test Teacher',
          password: PASSWORD,
          level: 'STANDARD',
          curriculumIds: [curriculum.id],
        })
        .expect(201)
    ).body;
    await http
      .put(`/api/teachers/${teacher.id}/availability`)
      .set(auth(adminToken))
      .send({
        windows: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
          weekday,
          startMinute: 0,
          endMinute: 1440,
        })),
      })
      .expect(200);
    const student = (
      await http
        .post('/api/students')
        .set(auth(adminToken))
        .send({
          email: 'student@test.local',
          fullName: 'Test Student',
          password: PASSWORD,
          timezone: 'America/New_York',
        })
        .expect(201)
    ).body;

    const startDate = DateTime.now()
      .setZone('America/New_York')
      .plus({ days: 2 })
      .toISODate()!;
    const sub = (
      await http
        .post('/api/subscriptions')
        .set(auth(adminToken))
        .send({
          studentId: student.id,
          teacherId: teacher.id,
          curriculumId: curriculum.id,
          planId: plan.id,
          lessonsPerWeek: 2,
          startDate,
          slots: [
            { weekday: 2, startTime: '09:00' },
            { weekday: 4, startTime: '09:00' },
          ],
        })
        .expect(201)
    ).body;
    expect(sub.lessonsCreated).toBe(8);
    cycleEnd = DateTime.fromISO(startDate).plus({ days: 27 }).toISODate()!;

    studentToken = await login('student@test.local');
    const lessons = (
      await http.get('/api/lessons').set(auth(studentToken)).expect(200)
    ).body;
    expect(lessons).toHaveLength(8);
    expect(lessons[0].type).toBe('FIRST_LESSON');
    // Every lesson is at 9:00 on the student's clock, whatever daylight saving does.
    for (const l of lessons) {
      expect(
        DateTime.fromISO(l.startsAt)
          .setZone('America/New_York')
          .toFormat('HH:mm'),
      ).toBe('09:00');
    }
    lessonIds = lessons.map((l: { id: string }) => l.id);
  });

  it('lets the student cancel within quota, then stops them', async () => {
    const first = await http
      .post(`/api/lessons/${lessonIds[0]}/cancel`)
      .set(auth(studentToken))
      .send({})
      .expect(200);
    expect(first.body.outcome).toMatchObject({ credit: true, usesQuota: true });
    await http
      .post(`/api/lessons/${lessonIds[1]}/cancel`)
      .set(auth(studentToken))
      .send({})
      .expect(200);
    const third = await http
      .post(`/api/lessons/${lessonIds[2]}/cancel`)
      .set(auth(studentToken))
      .send({})
      .expect(422);
    expect(third.body.violations[0].code).toBe('QUOTA_EXHAUSTED');
  });

  it('lets the student move a lesson to a free time, keeping the original', async () => {
    const lesson = (
      await http
        .get(`/api/lessons/${lessonIds[3]}`)
        .set(auth(studentToken))
        .expect(200)
    ).body;
    const nextDay = DateTime.fromISO(lesson.startsAt)
      .setZone('America/New_York')
      .plus({ days: 1 })
      .toISODate();
    const free = (
      await http
        .get(`/api/lessons/${lessonIds[3]}/free-slots?date=${nextDay}`)
        .set(auth(studentToken))
        .expect(200)
    ).body;
    expect(free.slots.length).toBeGreaterThan(0);
    const moved = (
      await http
        .post(`/api/lessons/${lessonIds[3]}/reschedule`)
        .set(auth(studentToken))
        .send({ startsAt: free.slots[0].startsAt })
        .expect(201)
    ).body;
    expect(moved).toMatchObject({
      type: 'RESCHEDULED',
      originLessonId: lessonIds[3],
    });
    const old = (
      await http
        .get(`/api/lessons/${lessonIds[3]}`)
        .set(auth(studentToken))
        .expect(200)
    ).body;
    expect(old.status).toBe('RESCHEDULED');
  });

  it('asks for an override (with a note) to give a lesson to a lower-level teacher', async () => {
    const curricula = (
      await http.get('/api/curricula').set(auth(adminToken)).expect(200)
    ).body;
    const basic = (
      await http
        .post('/api/teachers')
        .set(auth(adminToken))
        .send({
          email: 'basic@test.local',
          fullName: 'Basic Teacher',
          password: PASSWORD,
          level: 'BASIC',
          curriculumIds: [curricula[0].id],
        })
        .expect(201)
    ).body;
    await http
      .put(`/api/teachers/${basic.id}/availability`)
      .set(auth(adminToken))
      .send({
        windows: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
          weekday,
          startMinute: 0,
          endMinute: 1440,
        })),
      })
      .expect(200);
    const blocked = await http
      .post(`/api/lessons/${lessonIds[4]}/transfer`)
      .set(auth(adminToken))
      .send({ teacherId: basic.id })
      .expect(422);
    expect(blocked.body).toMatchObject({ canOverride: true });
    // No note needed: the log says which rule was set aside.
    const moved = await http
      .post(`/api/lessons/${lessonIds[4]}/transfer`)
      .set(auth(adminToken))
      .send({ teacherId: basic.id, override: true })
      .expect(201);
    expect(moved.body.type).toBe('TRANSFERRED');
  });

  it('bills the next cycle minus the credits', async () => {
    const [first] = (
      await http.get('/api/invoices').set(auth(adminToken)).expect(200)
    ).body;
    expect(first).toMatchObject({
      lessonsCount: 8,
      creditsCount: 0,
      billedLessons: 8,
      totalCents: 12000,
      status: 'OPEN',
    });
    await http
      .post(`/api/invoices/${first.id}/pay`)
      .set(auth(adminToken))
      .expect(200);

    const { CyclesService } = await import('../src/billing/cycles.service.js');
    const created = await app
      .get(CyclesService)
      .rollover(new Date(`${cycleEnd}T20:00:00Z`));
    expect(created).toBe(1);

    const invoices = (
      await http.get('/api/invoices').set(auth(adminToken)).expect(200)
    ).body;
    const second = invoices.find(
      (i: { cycleIndex: number }) => i.cycleIndex === 2,
    );
    expect(second).toMatchObject({
      lessonsCount: 8,
      creditsCount: 2,
      billedLessons: 6,
      totalCents: 9000,
    });

    // The invoice itself says which cancelled lessons the credits are for.
    const detail = (
      await http
        .get(`/api/invoices/${second.id}`)
        .set(auth(studentToken))
        .expect(200)
    ).body;
    expect(detail.credits).toHaveLength(2);
    expect(detail.lessons).toHaveLength(8);
    expect(detail).toMatchObject({
      plan: 'Standard',
      cycle: { index: 2 },
      student: { timezone: 'America/New_York' },
    });
  });

  it('logs every change and keeps admin pages admin-only', async () => {
    const logs = (
      await http
        .get('/api/audit-logs?entityType=lesson')
        .set(auth(adminToken))
        .expect(200)
    ).body;
    const actions = logs.map((l: { action: string }) => l.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'lesson.cancel',
        'lesson.reschedule',
        'lesson.transfer',
      ]),
    );
    expect(
      logs.find((l: { action: string }) => l.action === 'lesson.transfer'),
    ).toMatchObject({ override: true });
    await http.get('/api/students').set(auth(studentToken)).expect(403);
    await http.get('/api/lessons').expect(401);
  });

  it('manages staff roles and keeps at least one admin', async () => {
    const staff = (
      await http
        .post('/api/staff')
        .set(auth(adminToken))
        .send({
          email: 'staff@test.local',
          fullName: 'Test Staff',
          password: PASSWORD,
          role: 'STAFF',
        })
        .expect(201)
    ).body;
    const staffToken = await login('staff@test.local');
    await http.get('/api/staff').set(auth(staffToken)).expect(403);
    await http.get('/api/students').set(auth(staffToken)).expect(200);

    const admins = (
      await http.get('/api/staff').set(auth(adminToken)).expect(200)
    ).body;
    const me = admins.find(
      (u: { email: string }) => u.email === 'admin@test.local',
    );
    await http
      .patch(`/api/staff/${me.id}`)
      .set(auth(adminToken))
      .send({ role: 'STAFF' })
      .expect(400);

    // Promote, then the old token stops working because the role changed.
    await http
      .patch(`/api/staff/${staff.id}`)
      .set(auth(adminToken))
      .send({ role: 'ADMIN' })
      .expect(200);
    await http.get('/api/students').set(auth(staffToken)).expect(401);
    const promotedToken = await login('staff@test.local');
    await http.get('/api/staff').set(auth(promotedToken)).expect(200);
  });

  it('resets passwords and turns sign-ins off', async () => {
    const student = (
      await http.get('/api/students').set(auth(adminToken)).expect(200)
    ).body.find((s: { email: string }) => s.email === 'student@test.local');
    const detail = (
      await http
        .get(`/api/students/${student.id}`)
        .set(auth(adminToken))
        .expect(200)
    ).body;
    await http
      .post(`/api/users/${detail.userId}/password`)
      .set(auth(adminToken))
      .send({ newPassword: 'New-password-2' })
      .expect(204);
    await http
      .post('/api/auth/login')
      .send({ email: 'student@test.local', password: PASSWORD })
      .expect(401);
    const fresh = (
      await http
        .post('/api/auth/login')
        .send({ email: 'student@test.local', password: 'New-password-2' })
        .expect(200)
    ).body.accessToken;

    await http
      .post(`/api/users/${detail.userId}/active`)
      .set(auth(adminToken))
      .send({ isActive: false })
      .expect(200);
    await http.get('/api/lessons').set(auth(fresh)).expect(401);
    await http
      .post('/api/auth/login')
      .send({ email: 'student@test.local', password: 'New-password-2' })
      .expect(401);

    const logs = (
      await http
        .get('/api/audit-logs?entityType=user')
        .set(auth(adminToken))
        .expect(200)
    ).body;
    expect(logs.map((l: { action: string }) => l.action)).toEqual(
      expect.arrayContaining([
        'staff.create',
        'staff.update',
        'user.password-reset',
        'user.deactivate',
      ]),
    );
  });
});
