/**
 * Adding students and teachers from a spreadsheet. WIPES the database at TEST_DATABASE_URL.
 */
import {
  auth,
  PASSWORD,
  startApp,
  type TestApp,
  testDbUrl,
} from './helpers.js';

const suite = testDbUrl ? describe : describe.skip;

suite('spreadsheet import (e2e)', () => {
  let t: TestApp;
  let staffToken: string;
  const post = (
    kind: 'students' | 'teachers',
    body: object,
    token = t.adminToken,
  ) => t.http.post(`/api/import/${kind}`).set(auth(token)).send(body);

  const students = [
    {
      fullName: 'Sara Ali',
      email: 'Sara.Ali@example.com',
      timezone: 'Toronto',
      phone: '+1 416 555 0100',
    },
    {
      fullName: 'Liam Smith',
      email: 'liam@example.com',
      timezone: 'Australia/Sydney',
      password: 'Chosen-pass-1',
    },
  ];

  beforeAll(async () => {
    t = await startApp();
    await t.http
      .post('/api/staff')
      .set(auth(t.adminToken))
      .send({
        email: 'staff.imp@test.local',
        fullName: 'Staff Imp',
        password: PASSWORD,
        role: 'STAFF',
      })
      .expect(201);
    staffToken = await t.login('staff.imp@test.local');
    await t.http
      .post('/api/curricula')
      .set(auth(t.adminToken))
      .send({ name: 'Foundations 1' })
      .expect(201);
    await t.http
      .post('/api/curricula')
      .set(auth(t.adminToken))
      .send({ name: 'Reading 1' })
      .expect(201);
  });

  afterAll(async () => {
    await t?.app.close();
  });

  it('is for admins only', async () => {
    await post('students', { rows: students }, staffToken).expect(403);
  });

  it('checks first and creates nothing', async () => {
    const res = (
      await post('students', {
        rows: [...students, { fullName: 'X', email: 'nope', timezone: 'Mars' }],
      }).expect(200)
    ).body;
    expect(res.created).toBeNull();
    expect(
      res.rows.map((r: { problems: string[] }) => r.problems.length),
    ).toEqual([0, 0, 3]);
    // Even with commit, one bad row means no one is created.
    expect(
      (
        await post('students', {
          rows: [
            ...students,
            { fullName: 'X', email: 'nope', timezone: 'Mars' },
          ],
          commit: true,
        }).expect(200)
      ).body.created,
    ).toBeNull();
    const list = (
      await t.http.get('/api/students').set(auth(t.adminToken)).expect(200)
    ).body;
    expect(list).toHaveLength(0);
  });

  it('creates every account and hands back the passwords', async () => {
    const res = (
      await post('students', { rows: students, commit: true }).expect(200)
    ).body;
    expect(res.created).toEqual([
      {
        fullName: 'Sara Ali',
        email: 'sara.ali@example.com',
        password: expect.stringMatching(/^[A-Za-z2-9]{12}$/),
        generated: true,
      },
      {
        fullName: 'Liam Smith',
        email: 'liam@example.com',
        password: 'Chosen-pass-1',
        generated: false,
      },
    ]);
    // They can sign in straight away.
    await t.http
      .post('/api/auth/login')
      .send({
        email: 'sara.ali@example.com',
        password: res.created[0].password,
      })
      .expect(200);
    const list = (
      await t.http.get('/api/students').set(auth(t.adminToken)).expect(200)
    ).body as { fullName: string; timezone: string }[];
    expect(list.find((s) => s.fullName === 'Sara Ali')?.timezone).toBe(
      'America/Toronto',
    );

    const log = (
      await t.http
        .get('/api/audit-logs?action=student.import')
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    expect(log[0].summary).toBe(
      'Imported 2 students from a spreadsheet: Sara Ali, Liam Smith',
    );
    expect(JSON.stringify(log)).not.toContain('Chosen-pass-1');

    // The same file again: those emails are taken.
    const again = (await post('students', { rows: students }).expect(200)).body;
    expect(again.rows[0].problems).toEqual([
      'Someone already has an account with this email.',
    ]);
  });

  it('imports teachers with their level, curricula and rate', async () => {
    const rows = [
      {
        fullName: 'Hoda Samy',
        email: 'hoda@example.com',
        level: 'Premium',
        curricula: 'foundations 1; Reading 1',
        hourlyRate: '250',
        zoomLink: 'https://zoom.us/j/123',
      },
      {
        fullName: 'Omar Adel',
        email: 'omar.adel@example.com',
        level: 'basic',
        curricula: 'Foundations 1',
      },
    ];
    const res = (await post('teachers', { rows, commit: true }).expect(200))
      .body;
    expect(res.created).toHaveLength(2);
    const list = (
      await t.http.get('/api/teachers').set(auth(t.adminToken)).expect(200)
    ).body as { id: string; fullName: string }[];
    const hoda = list.find((x) => x.fullName === 'Hoda Samy')!;
    const detail = (
      await t.http
        .get(`/api/teachers/${hoda.id}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    expect(detail).toMatchObject({
      level: 'PREMIUM',
      hourlyRateCents: 25000,
      rateCurrency: 'EGP',
      zoomLink: 'https://zoom.us/j/123',
    });
    expect(
      detail.curricula.map((c: { name: string }) => c.name).sort(),
    ).toEqual(['Foundations 1', 'Reading 1']);

    const bad = (
      await post('teachers', {
        rows: [
          {
            fullName: 'Z Z',
            email: 'z@example.com',
            level: 'Gold',
            curricula: 'Tajweed',
          },
        ],
      }).expect(200)
    ).body;
    expect(bad.rows[0].problems).toHaveLength(2);
  });

  it('refuses very large files', async () => {
    const rows = Array.from({ length: 301 }, (_, i) => ({
      fullName: `P ${i}`,
      email: `p${i}@example.com`,
      timezone: 'UTC',
    }));
    await post('students', { rows }).expect(400);
  });
});
