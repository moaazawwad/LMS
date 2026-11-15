/**
 * Unpaid invoices: the notices, two lessons of grace, lessons on hold, and
 * what a payment brings back. Also how a payment is recorded and taken back,
 * and the bell. WIPES the database at TEST_DATABASE_URL.
 */
import { DateTime } from 'luxon';
import pg from 'pg';
import { CyclesService } from '../src/billing/cycles.service.js';
import { UnpaidService } from '../src/billing/unpaid.service.js';
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
const MIN = 60_000;

interface Lesson {
  id: string;
  startsAt: string;
  status: string;
  cancelReason: string | null;
}
interface Notice {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
}

suite('unpaid invoices (e2e)', () => {
  let t: TestApp;
  let school: School;
  let pool: pg.Pool;
  let unpaid: UnpaidService;
  let staffToken: string;
  /** student 1: goes through hold and payment */
  let s1: { id: string; token: string; invoiceId: string };
  /** student 2: hold, then billed for the lessons taken only */
  let s2: { id: string; token: string; invoiceId: string };
  /** student 3: pays on time, sees the renewal notice */
  let s3: { id: string; token: string; invoiceId: string };

  const lessonsOf = async (studentId: string) =>
    (
      (
        await t.http
          .get(`/api/lessons?studentId=${studentId}`)
          .set(auth(t.adminToken))
          .expect(200)
      ).body as Lesson[]
    ).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const invoiceOf = async (studentId: string) =>
    (
      await t.http
        .get(`/api/invoices?studentId=${studentId}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body as {
      id: string;
      status: string;
      totalCents: number;
      onHold: boolean;
      overdue: boolean;
      cycleEnd: string;
      replacesId: string | null;
    }[];
  const bell = async (token: string) =>
    (await t.http.get('/api/notifications').set(auth(token)).expect(200))
      .body as { unread: number; items: Notice[] };
  const subOf = async (studentId: string) =>
    (
      await pool.query(
        `select id, status, held_for_invoice_id as "heldFor" from subscriptions where student_id = $1`,
        [studentId],
      )
    ).rows[0] as { id: string; status: string; heldFor: string | null };
  const at = (iso: string, minutes: number) =>
    new Date(new Date(iso).getTime() + minutes * MIN);

  beforeAll(async () => {
    t = await startApp();
    pool = new pg.Pool({ connectionString: testDbUrl });
    unpaid = t.app.get(UnpaidService);
    school = await setUpSchool(t, 3, 'unpaid');
    const made = [];
    for (const s of school.students) {
      const [inv] = await invoiceOf(s.id);
      made.push({ id: s.id, token: await t.login(s.email), invoiceId: inv.id });
    }
    [s1, s2, s3] = made;
    await t.http
      .post('/api/staff')
      .set(auth(t.adminToken))
      .send({
        email: 'staff.unpaid@test.local',
        fullName: 'Staff Unpaid',
        password: PASSWORD,
        role: 'STAFF',
      })
      .expect(201);
    staffToken = await t.login('staff.unpaid@test.local');
    // Student 3 pays straight away.
    await t.http
      .post(`/api/invoices/${s3.invoiceId}/pay`)
      .set(auth(t.adminToken))
      .send({ method: 'BANK_TRANSFER', reference: 'TRX-3' })
      .expect(200);
  });

  afterAll(async () => {
    await pool.end();
    await t.app.close();
  });

  it('says nothing while no lesson is near', async () => {
    const lessons = await lessonsOf(s1.id);
    const r = await unpaid.check(at(lessons[0].startsAt, -180));
    expect(r).toEqual({ warned: 0, held: 0, headsUp: 0 });
    expect((await bell(s1.token)).items).toHaveLength(0);
  });

  it('tells the student with each of the two lessons, once each', async () => {
    const lessons = await lessonsOf(s1.id);
    const mail = t.app.get(MailService);
    const before = mail.sent.length;

    // Half an hour before lesson 1 (students 1 and 2 are both unpaid).
    const first = await unpaid.check(at(lessons[0].startsAt, -30));
    expect(first.warned).toBeGreaterThanOrEqual(1);
    expect(first.held).toBe(0);
    let mine = await bell(s1.token);
    expect(mine.unread).toBe(1);
    expect(mine.items[0]).toMatchObject({
      kind: 'payment.due',
      link: `/student/invoices/${s1.invoiceId}`,
    });
    expect(mine.items[0].body).toContain('lesson 1 of 2');
    expect(mine.items[0].body).toContain('$120.00');

    // The job runs again five minutes later: nothing new.
    await unpaid.check(at(lessons[0].startsAt, -25));
    expect((await bell(s1.token)).items).toHaveLength(1);

    // Lesson 1 is over; half an hour before lesson 2.
    await unpaid.check(at(lessons[1].startsAt, -30));
    mine = await bell(s1.token);
    expect(mine.items).toHaveLength(2);
    expect(mine.items[0].body).toContain('the last one you can take');

    // Each notice was emailed too.
    await mail.flush();
    const emails = mail.sent
      .slice(before)
      .filter((m) => m.to === school.students[0].email);
    expect(emails).toHaveLength(2);
    expect(emails[0].subject).toContain('is not paid yet');

    // Nothing was stopped so far.
    expect((await subOf(s1.id)).status).toBe('ACTIVE');
    expect(
      (await lessonsOf(s1.id)).every((l) => l.status === 'SCHEDULED'),
    ).toBe(true);
  });

  it('shows the student what is due and how many lessons are left', async () => {
    const due = (
      await t.http.get('/api/invoices/due').set(auth(s1.token)).expect(200)
    ).body;
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({
      id: s1.invoiceId,
      totalCents: 12000,
      lessonsTaken: 0,
      lessonsLeftBeforeHold: 2,
      onHold: false,
    });
    // Staff don't have a "due" of their own.
    await t.http.get('/api/invoices/due').set(auth(t.adminToken)).expect(403);
  });

  it('removes the remaining lessons after the second one', async () => {
    // Student 2's lessons are two hours after student 1's: once their second
    // lesson is over, both have used their two lessons.
    const afterSecond = at((await lessonsOf(s2.id))[1].startsAt, 65);
    const r = await unpaid.check(afterSecond);
    expect(r.held).toBe(2); // students 1 and 2

    const sub = await subOf(s1.id);
    expect(sub).toMatchObject({ status: 'PAUSED', heldFor: s1.invoiceId });
    const now = await lessonsOf(s1.id);
    // The two lessons taken stay; the six ahead are removed, with no credit.
    expect(now.slice(0, 2).every((l) => l.status === 'SCHEDULED')).toBe(true);
    expect(now.slice(2)).toHaveLength(6);
    expect(
      now
        .slice(2)
        .every((l) => l.status === 'CANCELLED' && l.cancelReason === 'UNPAID'),
    ).toBe(true);
    const credits = await pool.query(
      `select count(*)::int as n from lesson_credits where student_id = $1`,
      [s1.id],
    );
    expect(credits.rows[0].n).toBe(0);

    // Running again changes nothing.
    expect((await unpaid.check(afterSecond)).held).toBe(0);

    // The invoice is still due, and marked on hold for staff.
    const [inv] = await invoiceOf(s1.id);
    expect(inv).toMatchObject({ status: 'OPEN', onHold: true });
    const detail = (
      await t.http
        .get(`/api/invoices/${s1.invoiceId}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    expect(detail.standing).toMatchObject({ onHold: true, lessonsRemoved: 6 });

    // Everyone concerned was told.
    const student = await bell(s1.token);
    expect(student.items[0]).toMatchObject({ kind: 'payment.hold' });
    const admin = await bell(t.adminToken);
    expect(admin.items.filter((n) => n.kind === 'payment.hold').length).toBe(2);
    expect((await bell(staffToken)).items.length).toBe(2);
    const teacher = await bell(await t.login(school.teacher.email));
    expect(teacher.items.some((n) => n.kind === 'lessons.hold')).toBe(true);

    // The activity log has it, as the system's doing.
    const log = (
      await t.http
        .get(`/api/audit-logs?entityType=invoice&entityId=${s1.invoiceId}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    const rows = Array.isArray(log) ? log : log.items;
    expect(
      rows.some((e: { action: string }) => e.action === 'invoice.hold'),
    ).toBe(true);
  });

  it('checks how a payment is recorded', async () => {
    const pay = (body: object, token = t.adminToken) =>
      t.http
        .post(`/api/invoices/${s1.invoiceId}/pay`)
        .set(auth(token))
        .send(body);
    await pay({ method: 'BITCOIN' }).expect(400);
    const tomorrow = DateTime.now()
      .setZone('Africa/Cairo')
      .plus({ days: 1 })
      .toISODate();
    await pay({ method: 'INSTAPAY', receivedOn: tomorrow }).expect(400);
    await pay({ method: 'INSTAPAY' }, s1.token).expect(403);
    expect((await invoiceOf(s1.id))[0].status).toBe('OPEN');
  });

  it('brings the lessons back when the invoice is paid', async () => {
    // One removed lesson has passed meanwhile: it cannot come back.
    const lessons = await lessonsOf(s1.id);
    await pool.query(
      `update lessons set starts_at = now() - interval '2 hours' where id = $1`,
      [lessons[2].id],
    );
    const paid = (
      await t.http
        .post(`/api/invoices/${s1.invoiceId}/pay`)
        .set(auth(staffToken))
        .send({
          method: 'INSTAPAY',
          reference: ' IP-778899 ',
          note: 'Paid by the father',
        })
        .expect(200)
    ).body;
    expect(paid).toMatchObject({
      status: 'PAID',
      paymentMethod: 'INSTAPAY',
      paymentReference: 'IP-778899',
      resumed: { restored: 5, credited: 1, active: true },
    });

    expect(await subOf(s1.id)).toMatchObject({
      status: 'ACTIVE',
      heldFor: null,
    });
    const now = await lessonsOf(s1.id);
    expect(now.filter((l) => l.status === 'SCHEDULED')).toHaveLength(7);
    // The missed one became a credit for the next invoice.
    const credits = await pool.query(
      `select status from lesson_credits where student_id = $1`,
      [s1.id],
    );
    expect(credits.rows).toEqual([{ status: 'PENDING' }]);
    expect((await invoiceOf(s1.id))[0]).toMatchObject({
      status: 'PAID',
      onHold: false,
    });

    // Staff see who recorded it and the note; the student sees how, not the note.
    const forStaff = (
      await t.http
        .get(`/api/invoices/${s1.invoiceId}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body.payment;
    expect(forStaff).toMatchObject({
      method: 'INSTAPAY',
      reference: 'IP-778899',
      recordedBy: 'Staff Unpaid',
      note: 'Paid by the father',
    });
    const forStudent = (
      await t.http
        .get(`/api/invoices/${s1.invoiceId}`)
        .set(auth(s1.token))
        .expect(200)
    ).body.payment;
    expect(forStudent).toMatchObject({
      method: 'INSTAPAY',
      recordedBy: null,
      note: null,
    });
    const student = await bell(s1.token);
    expect(student.items.map((n) => n.kind)).toEqual(
      expect.arrayContaining(['payment.resumed', 'payment.received']),
    );
    expect(
      (await t.http.get('/api/invoices/due').set(auth(s1.token)).expect(200))
        .body,
    ).toEqual([]);
  });

  it('lets only an admin take a payment back, with a reason', async () => {
    const unpay = (body: object, token: string) =>
      t.http
        .post(`/api/invoices/${s3.invoiceId}/unpay`)
        .set(auth(token))
        .send(body);
    await unpay({ reason: 'Wrong student' }, staffToken).expect(403);
    await unpay({ reason: '' }, t.adminToken).expect(400);
    const row = (
      await unpay({ reason: 'Wrong student' }, t.adminToken).expect(200)
    ).body;
    expect(row).toMatchObject({
      status: 'OPEN',
      paidAt: null,
      paymentMethod: null,
      paymentReference: null,
    });
    // An open invoice has no payment to take back.
    await unpay({ reason: 'Again' }, t.adminToken).expect(409);
    // Paid again, properly.
    await t.http
      .post(`/api/invoices/${s3.invoiceId}/pay`)
      .set(auth(t.adminToken))
      .send({ method: 'CASH' })
      .expect(200);
  });

  it('can bill only the lessons taken when the family does not come back', async () => {
    expect(await subOf(s2.id)).toMatchObject({
      status: 'PAUSED',
      heldFor: s2.invoiceId,
    });
    const voidIt = (body: object) =>
      t.http
        .post(`/api/invoices/${s2.invoiceId}/void`)
        .set(auth(t.adminToken))
        .send(body);
    await voidIt({ reason: 'Left the academy', billLessons: 2 }).expect(400);
    await voidIt({
      reason: 'Left the academy',
      reissue: true,
      billLessons: 9,
    }).expect(400);
    // A credit for a lesson of this unpaid cycle (cancelled in time earlier)
    // must not make the two lessons taken cheaper.
    const removed = (await lessonsOf(s2.id))[5];
    await pool.query(
      `insert into lesson_credits (student_id, lesson_id) values ($1, $2)`,
      [s2.id, removed.id],
    );
    const done = (
      await voidIt({
        reason: 'Left the academy',
        reissue: true,
        billLessons: 2,
      }).expect(200)
    ).body;
    expect(done.replacement.totalCents).toBe(2 * 1500);
    const left = await pool.query(
      `select count(*)::int as n from lesson_credits where student_id = $1`,
      [s2.id],
    );
    expect(left.rows[0].n).toBe(0);

    // The lessons stay removed and the subscription is an ordinary pause now.
    expect(await subOf(s2.id)).toMatchObject({
      status: 'PAUSED',
      heldFor: null,
    });
    const paid = (
      await t.http
        .post(`/api/invoices/${done.replacement.id}/pay`)
        .set(auth(t.adminToken))
        .send({ method: 'BANK_TRANSFER' })
        .expect(200)
    ).body;
    expect(paid.resumed).toBeNull();
    expect((await subOf(s2.id)).status).toBe('PAUSED');
    expect(
      (await lessonsOf(s2.id)).filter((l) => l.status === 'CANCELLED'),
    ).toHaveLength(6);
  });

  it('gives a paid-up student the heads-up at the last lesson of the cycle', async () => {
    const lessons = await lessonsOf(s3.id);
    const last = lessons[lessons.length - 1];
    // Not at an earlier lesson.
    expect((await unpaid.check(at(lessons[3].startsAt, -30))).headsUp).toBe(0);
    const r = await unpaid.check(at(last.startsAt, -30));
    expect(r).toMatchObject({ headsUp: 1, held: 0 });
    const mine = await bell(s3.token);
    const notice = mine.items.find((n) => n.kind === 'payment.renewal')!;
    expect(notice.title).toBe('Your next four weeks start soon');
    expect(notice.body).toContain('2 lessons');
    // Once per cycle.
    expect((await unpaid.check(at(last.startsAt, -20))).headsUp).toBe(0);
  });

  it('opens no new cycle on top of an unpaid one', async () => {
    const cycles = t.app.get(CyclesService);
    const [inv] = await invoiceOf(s3.id);
    const lastDay = DateTime.fromISO(inv.cycleEnd, {
      zone: 'America/New_York',
    })
      .set({ hour: 12 })
      .toJSDate();
    // Student 3 is paid up: the next cycle opens (student 1 too).
    await t.http
      .post(`/api/invoices/${s3.invoiceId}/unpay`)
      .set(auth(t.adminToken))
      .send({ reason: 'Testing the rollover' })
      .expect(200);
    const count = async () =>
      (
        await pool.query(
          `select count(*)::int as n from billing_cycles c join subscriptions s on s.id = c.subscription_id where s.student_id = $1`,
          [s3.id],
        )
      ).rows[0].n as number;
    await cycles.rollover(lastDay);
    expect(await count()).toBe(1);
    await t.http
      .post(`/api/invoices/${s3.invoiceId}/pay`)
      .set(auth(t.adminToken))
      .send({ method: 'CASH' })
      .expect(200);
    await cycles.rollover(lastDay);
    expect(await count()).toBe(2);
  });

  it('keeps each bell private and marks notices read', async () => {
    const mine = await bell(s1.token);
    expect(mine.unread).toBeGreaterThan(1);
    const someoneElse = await bell(t.adminToken);
    // Marking someone else's notice does nothing.
    const stolen = (
      await t.http
        .post('/api/notifications/read')
        .set(auth(s1.token))
        .send({ ids: [someoneElse.items[0].id] })
        .expect(200)
    ).body;
    expect(stolen.read).toBe(0);
    const one = (
      await t.http
        .post('/api/notifications/read')
        .set(auth(s1.token))
        .send({ ids: [mine.items[0].id] })
        .expect(200)
    ).body;
    expect(one.read).toBe(1);
    await t.http
      .post('/api/notifications/read')
      .set(auth(s1.token))
      .send({})
      .expect(200);
    expect(
      (
        await t.http
          .get('/api/notifications/unread')
          .set(auth(s1.token))
          .expect(200)
      ).body,
    ).toEqual({ unread: 0 });
    await t.http.get('/api/notifications').expect(401);
  });
});
