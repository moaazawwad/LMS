/**
 * Emails: new invoices, "forgot password" links and lesson reminders.
 * WIPES the database at TEST_DATABASE_URL. Emails stay in memory.
 */
import pg from 'pg';
import { RemindersService } from '../src/lessons/reminders.service.js';
import { MailService } from '../src/mail/mail.service.js';
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

suite('emails (e2e)', () => {
  let t: TestApp;
  let school: School;
  let pool: pg.Pool;
  let mail: MailService;
  const inbox = (to: string) => mail.sent.filter((m) => m.to === to);
  const linkToken = (text: string) =>
    /reset-password\?token=([\w-]+)/.exec(text)?.[1];

  beforeAll(async () => {
    t = await startApp();
    school = await setUpSchool(t, 1, 'mail');
    pool = new pg.Pool({ connectionString: testDbUrl });
    mail = t.app.get(MailService);
    await mail.flush();
  });

  afterAll(async () => {
    await pool?.end();
    await t?.app.close();
  });

  it('emails the student their new invoice', async () => {
    const [invoiceEmail] = inbox(school.students[0].email).filter(
      (m) => m.kind === 'invoice',
    );
    expect(invoiceEmail.subject).toMatch(
      /^Invoice INV-\d{4} from Brightverse Academy: \$120\.00$/,
    );
    expect(invoiceEmail.text).toContain(
      'https://academy.test/student/invoices/',
    );
    expect(invoiceEmail.html).toContain(
      'https://academy.test/brand/brightverse-logo-email.png',
    );
  });

  it('sends a one-time link to set a new password', async () => {
    const email = school.students[0].email;
    await t.http
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@test.local' })
      .expect(200);
    await t.http
      .post('/api/auth/forgot-password')
      .send({ email: email.toUpperCase() })
      .expect(200);
    await mail.flush();
    const [message] = inbox(email).filter((m) => m.kind === 'password-reset');
    expect(inbox('nobody@test.local')).toHaveLength(0);
    const token = linkToken(message.text)!;
    expect(message.text).toContain(
      `https://academy.test/reset-password?token=${token}`,
    );

    await t.http
      .post('/api/auth/reset-password')
      .send({ token, password: 'short' })
      .expect(400);
    await t.http
      .post('/api/auth/reset-password')
      .send({ token, password: 'A-brand-new-pass-1' })
      .expect(200);
    await t.http
      .post('/api/auth/login')
      .send({ email, password: PASSWORD })
      .expect(401);
    await t.http
      .post('/api/auth/login')
      .send({ email, password: 'A-brand-new-pass-1' })
      .expect(200);
    // Once only.
    const again = await t.http
      .post('/api/auth/reset-password')
      .send({ token, password: 'Another-pass-22' })
      .expect(400);
    expect(again.body.message).toContain('expired or was already used');
  });

  it('a link stops working after an hour, and an account gets at most 3 links an hour', async () => {
    const email = school.teacher.email;
    for (let i = 0; i < 4; i++)
      await t.http
        .post('/api/auth/forgot-password')
        .send({ email })
        .expect(200);
    await mail.flush();
    const links = inbox(email).filter((m) => m.kind === 'password-reset');
    expect(links).toHaveLength(3);
    await pool.query(
      `update password_resets set expires_at = now() - interval '1 minute'`,
    );
    await t.http
      .post('/api/auth/reset-password')
      .send({ token: linkToken(links[0].text), password: 'Teacher-new-pass-1' })
      .expect(400);
  });

  it('reminds the student and the teacher about an hour before, once', async () => {
    const lessonId = school.students[0].lessonIds[0];
    const now = new Date();
    await pool.query(`update lessons set starts_at = $2 where id = $1`, [
      lessonId,
      new Date(now.getTime() + 47 * 60_000),
    ]);
    const reminders = t.app.get(RemindersService);
    expect(await reminders.sendDue(now)).toBe(1);
    expect(await reminders.sendDue(now)).toBe(0);
    await mail.flush();
    const [toStudent] = inbox(school.students[0].email).filter(
      (m) => m.kind === 'lesson-reminder',
    );
    const [toTeacher] = inbox(school.teacher.email).filter(
      (m) => m.kind === 'lesson-reminder',
    );
    expect(toStudent.subject).toBe(
      'Your lesson with Teacher mail starts in about 45 minutes',
    );
    expect(toStudent.text).toContain('(New York time)');
    expect(toTeacher.text).toContain('(Cairo time)');
    expect(toTeacher.text).toContain('Student 1 mail');
  });

  it('tells the others when a lesson is cancelled, moved, or a request is declined', async () => {
    const [, , l2, l3, l4] = school.students[0].lessonIds;
    const studentEmail = school.students[0].email;
    const teacherEmail = school.teacher.email;
    const studentToken = (
      await t.http
        .post('/api/auth/login')
        .send({ email: studentEmail, password: 'A-brand-new-pass-1' })
        .expect(200)
    ).body.accessToken;
    const kinds = (to: string) => inbox(to).map((m) => m.kind);

    // The student cancels: only the teacher hears about it.
    await t.http
      .post(`/api/lessons/${l2}/cancel`)
      .set(auth(studentToken))
      .send({})
      .expect(200);
    await mail.flush();
    expect(kinds(teacherEmail)).toContain('lesson-cancelled');
    expect(kinds(studentEmail)).not.toContain('lesson-cancelled');
    const cancelled = inbox(teacherEmail).find(
      (m) => m.kind === 'lesson-cancelled',
    )!;
    expect(cancelled.text).toMatch(
      /Your lesson with Student 1 mail on \w{3}, \w{3} \d+ · \d+:\d{2} [AP]M \(Cairo time\) is cancelled\./,
    );

    // The academy moves one: both hear, each on their own clock.
    const lesson = (
      await t.http.get(`/api/lessons/${l3}`).set(auth(t.adminToken)).expect(200)
    ).body;
    const to = new Date(
      new Date(lesson.startsAt).getTime() + 60 * 60_000,
    ).toISOString();
    await t.http
      .post(`/api/lessons/${l3}/reschedule`)
      .set(auth(t.adminToken))
      .send({ startsAt: to })
      .expect(201);
    await mail.flush();
    expect(
      inbox(studentEmail).find((m) => m.kind === 'lesson-moved')!.text,
    ).toContain('(New York time)');
    expect(
      inbox(teacherEmail).find((m) => m.kind === 'lesson-moved')!.text,
    ).toContain('(Cairo time)');

    // A declined request: the student who asked gets the reply.
    const req = (
      await t.http
        .post('/api/requests')
        .set(auth(studentToken))
        .send({ lessonId: l4, kind: 'CANCEL', message: 'Travelling' })
        .expect(201)
    ).body;
    await t.http
      .post(`/api/requests/${req.id}/decline`)
      .set(auth(t.adminToken))
      .send({ note: 'Please move it instead' })
      .expect(200);
    await mail.flush();
    // The academy heard about the request when it was sent.
    expect(
      inbox('admin@test.local').find((m) => m.kind === 'request')!.text,
    ).toContain('Their message: Travelling');
    const declined = inbox(studentEmail).find(
      (m) => m.kind === 'lesson-declined',
    )!;
    expect(declined.text).toContain('Their reply: Please move it instead');
    expect(kinds(teacherEmail)).not.toContain('lesson-declined');
  });

  it('thanks the student when an invoice is marked paid', async () => {
    const [inv] = (
      await t.http
        .get(`/api/invoices?studentId=${school.students[0].id}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    await t.http
      .post(`/api/invoices/${inv.id}/pay`)
      .set(auth(t.adminToken))
      .expect(200);
    await mail.flush();
    expect(
      inbox(school.students[0].email).find((m) => m.kind === 'payment')!
        .subject,
    ).toBe(`Payment received for ${inv.number} · Brightverse Academy`);
  });

  it('shows the admin whether email is on, and sends a test', async () => {
    const status = (
      await t.http.get('/api/mail').set(auth(t.adminToken)).expect(200)
    ).body;
    expect(status).toMatchObject({
      enabled: true,
      mode: 'memory',
      appUrl: 'https://academy.test',
    });
    expect(
      status.recent.some(
        (r: { kind: string; status: string }) =>
          r.kind === 'lesson-reminder' && r.status === 'SENT',
      ),
    ).toBe(true);
    // Bodies are not kept once sent.
    const bodies = await pool.query(
      `select count(*)::int as n from email_outbox where text is not null and status <> 'PENDING'`,
    );
    expect(bodies.rows[0].n).toBe(0);

    expect(
      (
        await t.http
          .post('/api/mail/test')
          .set(auth(t.adminToken))
          .send({ to: 'me@test.local' })
          .expect(200)
      ).body,
    ).toEqual({ status: 'SENT', error: null });
    const teacherToken = await t.login(school.teacher.email);
    await t.http.get('/api/mail').set(auth(teacherToken)).expect(403);
  });
});
