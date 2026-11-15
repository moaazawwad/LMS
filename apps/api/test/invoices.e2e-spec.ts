/**
 * Finding invoices, and voiding one (with a reason, optionally issuing a new
 * one for the same cycle). WIPES the database at TEST_DATABASE_URL.
 */
import { DateTime } from 'luxon';
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

interface Row {
  id: string;
  number: string;
  status: 'OPEN' | 'PAID' | 'VOID';
  studentName: string;
  extraCount: number;
  totalCents: number;
  priceCents: number;
  replacesId: string | null;
}

suite('invoices (e2e)', () => {
  let t: TestApp;
  let school: School;
  let studentToken: string;
  let staffToken: string;
  let subscriptionId: string;

  const list = async (query = '') =>
    (
      await t.http
        .get(`/api/invoices${query}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body as Row[];
  const detail = async (id: string, token = t.adminToken) =>
    (await t.http.get(`/api/invoices/${id}`).set(auth(token)).expect(200)).body;

  beforeAll(async () => {
    t = await startApp();
    school = await setUpSchool(t, 2, 'inv');
    studentToken = await t.login(school.students[0].email);
    await t.http
      .post('/api/staff')
      .set(auth(t.adminToken))
      .send({
        email: 'staff.inv@test.local',
        fullName: 'Staff Inv',
        password: PASSWORD,
        role: 'STAFF',
      })
      .expect(201);
    staffToken = await t.login('staff.inv@test.local');
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

  it('finds invoices by student, number, status and day', async () => {
    const all = await list();
    expect(all).toHaveLength(2);
    const mine = await list('?q=student 1 inv');
    expect(mine.map((r) => r.studentName)).toEqual(['Student 1 inv']);
    expect(await list(`?q=${all[0].number.toLowerCase()}`)).toHaveLength(1);
    expect(await list('?q=STUDENT2.INV@')).toHaveLength(1);
    // % and _ are plain characters, not wildcards.
    expect(await list('?q=%25')).toHaveLength(0);
    expect(await list('?status=PAID')).toHaveLength(0);

    const today = DateTime.now().setZone('Africa/Cairo').toISODate()!;
    const tomorrow = DateTime.now()
      .setZone('Africa/Cairo')
      .plus({ days: 1 })
      .toISODate()!;
    expect(await list(`?from=${today}&to=${today}`)).toHaveLength(2);
    expect(await list(`?from=${tomorrow}`)).toHaveLength(0);
    await t.http
      .get(`/api/invoices?from=${tomorrow}&to=${today}`)
      .set(auth(t.adminToken))
      .expect(400);

    // A student's search never reaches other students' invoices.
    const own = (
      await t.http
        .get('/api/invoices?q=student 2')
        .set(auth(studentToken))
        .expect(200)
    ).body as Row[];
    expect(own.map((r) => r.studentName)).toEqual(['Student 1 inv']);
  });

  it('counts what is due, paid and void', async () => {
    const s = (
      await t.http
        .get('/api/invoices/summary')
        .set(auth(staffToken))
        .expect(200)
    ).body;
    expect(s.open.count).toBe(2);
    expect(s.open.totals).toEqual([{ currency: 'USD', cents: 2 * 8 * 1500 }]);
    expect(s.paid.count).toBe(0);
    await t.http
      .get('/api/invoices/summary')
      .set(auth(studentToken))
      .expect(403);
  });

  it('needs an admin and a reason to void', async () => {
    const [inv] = await list('?q=student 1 inv');
    await t.http
      .post(`/api/invoices/${inv.id}/void`)
      .set(auth(staffToken))
      .send({ reason: 'Wrong price' })
      .expect(403);
    await t.http
      .post(`/api/invoices/${inv.id}/void`)
      .set(auth(t.adminToken))
      .send({})
      .expect(400);
    await t.http
      .post(`/api/invoices/${inv.id}/void`)
      .set(auth(t.adminToken))
      .send({ reason: '   ' })
      .expect(400);
  });

  it('voids and issues a new invoice for the same cycle, extra lessons included', async () => {
    const startsAt = DateTime.now()
      .setZone('America/New_York')
      .plus({ days: 3 })
      .set({ hour: 18, minute: 0, second: 0, millisecond: 0 })
      .toISO();
    await t.http
      .post('/api/lessons/extra')
      .set(auth(t.adminToken))
      .send({ subscriptionId, startsAt, extraReason: 'OTHER' })
      .expect(201);
    const [old] = await list('?q=student 1 inv');
    expect(old.extraCount).toBe(1);

    const res = (
      await t.http
        .post(`/api/invoices/${old.id}/void`)
        .set(auth(t.adminToken))
        .send({ reason: 'Price agreed with the family', reissue: true })
        .expect(200)
    ).body;
    expect(res.status).toBe('VOID');
    expect(res.replacement.number).not.toBe(old.number);

    const voided = await detail(old.id);
    expect(voided).toMatchObject({
      status: 'VOID',
      replacedBy: { id: res.replacement.id, number: res.replacement.number },
    });
    expect(voided.voided).toMatchObject({
      by: 'Admin',
      reason: 'Price agreed with the family',
    });
    expect(voided.voided.at).toBeTruthy();
    // The extra lesson moved to the new invoice.
    const fresh = await detail(res.replacement.id);
    expect(fresh).toMatchObject({
      status: 'OPEN',
      extraCount: 1,
      totalCents: old.totalCents,
      replaces: { id: old.id, number: old.number },
    });
    expect(fresh.extras).toHaveLength(1);
    expect(voided.extras).toHaveLength(0);

    // The student sees it was voided and replaced, not the internal reason.
    const seen = await detail(old.id, studentToken);
    expect(seen.voided).toMatchObject({ by: null, reason: null });
    expect(seen.replacedBy.number).toBe(res.replacement.number);

    // The subscription shows the live invoice for the cycle.
    const sub = (
      await t.http
        .get(`/api/subscriptions/${subscriptionId}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    expect(sub.cycles[0].invoice.id).toBe(res.replacement.id);

    const log = (
      await t.http
        .get(`/api/audit-logs?entityId=${old.id}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    expect(log[0]).toMatchObject({
      action: 'invoice.void',
      note: 'Price agreed with the family',
    });
    expect(log[0].summary).toContain('1 extra lesson back to waiting');

    await t.http
      .post(`/api/invoices/${old.id}/void`)
      .set(auth(t.adminToken))
      .send({ reason: 'Again' })
      .expect(409);
  });

  it('a paid invoice can be voided too, and without a new one the cycle is left unbilled', async () => {
    const [inv] = await list('?q=student 2 inv');
    await t.http
      .post(`/api/invoices/${inv.id}/pay`)
      .set(auth(t.adminToken))
      .expect(200);
    const res = (
      await t.http
        .post(`/api/invoices/${inv.id}/void`)
        .set(auth(t.adminToken))
        .send({ reason: 'Refunded: family moved' })
        .expect(200)
    ).body;
    expect(res.replacement).toBeNull();
    const log = (
      await t.http
        .get(`/api/audit-logs?entityId=${inv.id}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    expect(log[0].summary).toContain('(it was paid)');

    expect(await list('?status=VOID')).toHaveLength(2);
    const s = (
      await t.http
        .get('/api/invoices/summary')
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    expect(s).toMatchObject({
      open: { count: 1 },
      paid: { count: 0 },
      void: { count: 2 },
    });
  });

  it('shows how to pay on unpaid invoices and in the invoice email', async () => {
    await t.http
      .put('/api/academy-settings')
      .set(auth(staffToken))
      .send({ paymentInstructions: 'x' })
      .expect(403);
    const text =
      'Bank transfer: CIB 1000 2000 3000\nInstaPay: brightverse@instapay\nWrite the invoice number as the reference.';
    const saved = (
      await t.http
        .put('/api/academy-settings')
        .set(auth(t.adminToken))
        .send({ paymentInstructions: `  ${text}  ` })
        .expect(200)
    ).body;
    expect(saved.paymentInstructions).toBe(text);
    expect(
      (
        await t.http
          .get('/api/academy-settings')
          .set(auth(staffToken))
          .expect(200)
      ).body.paymentInstructions,
    ).toBe(text);

    const [open] = await list('?status=OPEN');
    expect((await detail(open.id)).paymentInstructions).toBe(text);
    const [voided] = await list('?status=VOID');
    expect((await detail(voided.id)).paymentInstructions).toBeNull();

    // A new student's first invoice email carries it.
    const mail = t.app.get(MailService);
    const more = await setUpSchool(t, 1, 'inv3');
    await mail.flush();
    const email = mail.sent.find(
      (m) => m.to === more.students[0].email && m.kind === 'invoice',
    )!;
    expect(email.text).toContain(
      'How to pay:\nBank transfer: CIB 1000 2000 3000',
    );
    expect(email.html).toContain('InstaPay: brightverse@instapay');

    // Empty removes it.
    expect(
      (
        await t.http
          .put('/api/academy-settings')
          .set(auth(t.adminToken))
          .send({ paymentInstructions: ' ' })
          .expect(200)
      ).body.paymentInstructions,
    ).toBeNull();
    expect((await detail(open.id)).paymentInstructions).toBeNull();
  });
});
