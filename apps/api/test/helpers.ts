/**
 * Shared setup for the end-to-end suites. Each suite wipes TEST_DATABASE_URL,
 * applies the migrations and starts the real app, so suites run one at a time
 * (see vitest.config.e2e.ts).
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { DateTime } from 'luxon';
import pg from 'pg';
import request from 'supertest';

export const PASSWORD = 'Test-password-1';
export const testDbUrl = process.env.TEST_DATABASE_URL;

export const auth = (token: string) => ({ authorization: `Bearer ${token}` });

export interface TestApp {
  app: INestApplication;
  http: ReturnType<typeof request>;
  login: (email: string) => Promise<string>;
  adminToken: string;
}

export async function startApp(): Promise<TestApp> {
  process.env.DATABASE_URL = testDbUrl;
  process.env.JWT_SECRET = 'e2e-secret-that-is-long-enough-for-checks';
  // Emails are kept in memory (MailService.sent) instead of sent.
  process.env.MAIL_TRANSPORT = 'memory';
  process.env.APP_URL = 'https://academy.test';

  const pool = new pg.Pool({ connectionString: testDbUrl });
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
  const app = configureApp(moduleRef.createNestApplication());
  await app.init();
  const http = request(app.getHttpServer());
  const login = async (email: string) =>
    (
      await http
        .post('/api/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200)
    ).body.accessToken as string;
  return { app, http, login, adminToken: await login('admin@test.local') };
}

export interface School {
  curriculumId: string;
  planId: string;
  teacher: { id: string; email: string };
  students: { id: string; email: string; lessonIds: string[] }[];
}

/**
 * One Standard plan, one teacher free all day, and `students` students in
 * New York with Tue/Thu lessons starting in two days (each at a different hour).
 */
export async function setUpSchool(
  t: TestApp,
  students = 1,
  prefix = 'x',
): Promise<School> {
  const { http, adminToken } = t;
  const curriculum = (
    await http
      .post('/api/curricula')
      .set(auth(adminToken))
      .send({ name: `Foundations ${prefix}` })
      .expect(201)
  ).body;
  // One plan per level: reuse Standard if an earlier school made it.
  const existing = (
    await http.get('/api/plans').set(auth(adminToken)).expect(200)
  ).body.find((p: { tier: string }) => p.tier === 'STANDARD');
  const plan =
    existing ??
    (
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
  const teacherEmail = `teacher.${prefix}@test.local`;
  const teacher = (
    await http
      .post('/api/teachers')
      .set(auth(adminToken))
      .send({
        email: teacherEmail,
        fullName: `Teacher ${prefix}`,
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

  const startDate = DateTime.now()
    .setZone('America/New_York')
    .plus({ days: 2 })
    .toISODate()!;
  const list: School['students'] = [];
  for (let i = 0; i < students; i++) {
    const email = `student${i + 1}.${prefix}@test.local`;
    const student = (
      await http
        .post('/api/students')
        .set(auth(adminToken))
        .send({
          email,
          fullName: `Student ${i + 1} ${prefix}`,
          password: PASSWORD,
          timezone: 'America/New_York',
        })
        .expect(201)
    ).body;
    const hour = String(9 + i * 2).padStart(2, '0');
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
          { weekday: 2, startTime: `${hour}:00` },
          { weekday: 4, startTime: `${hour}:00` },
        ],
      })
      .expect(201);
    const lessons = (
      await http
        .get(`/api/lessons?studentId=${student.id}`)
        .set(auth(adminToken))
        .expect(200)
    ).body;
    list.push({
      id: student.id,
      email,
      lessonIds: lessons.map((l: { id: string }) => l.id),
    });
  }
  return {
    curriculumId: curriculum.id,
    planId: plan.id,
    teacher: { id: teacher.id, email: teacherEmail },
    students: list,
  };
}
