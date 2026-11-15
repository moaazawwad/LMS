/**
 * Applications from the website: the public form, spam guards, and staff follow-up.
 * WIPES the database at TEST_DATABASE_URL.
 */
import { auth, startApp, type TestApp, testDbUrl } from './helpers.js';

const suite = testDbUrl ? describe : describe.skip;

suite('website applications (e2e)', () => {
  let t: TestApp;
  const site = 'https://www.brightverseacademy.com';
  let corsBefore: string | undefined;

  beforeAll(async () => {
    corsBefore = process.env.CORS_ORIGINS;
    process.env.CORS_ORIGINS = site;
    t = await startApp();
  });

  afterAll(async () => {
    process.env.CORS_ORIGINS = corsBefore;
    await t?.app.close();
  });

  it('takes an application without signing in', async () => {
    await t.http
      .post('/api/public/applications')
      .send({
        fullName: 'Sara Ali',
        email: 'Sara.Ali@Example.com',
        phone: '+1 555 222 3333',
        country: 'Canada',
        timezone: 'America/Toronto',
        curriculum: 'Quran for kids',
        preferredTimes: 'Weekends, mornings',
        studentAge: '9',
        message: 'For my daughter.',
        source: `${site}/apply`,
      })
      .expect(201, { ok: true });
    const list = (
      await t.http.get('/api/applications').set(auth(t.adminToken)).expect(200)
    ).body;
    expect(list[0]).toMatchObject({
      status: 'NEW',
      fullName: 'Sara Ali',
      email: 'sara.ali@example.com',
      curriculum: 'Quran for kids',
      preferredTimes: 'Weekends, mornings',
    });
    expect(
      (
        await t.http
          .get('/api/applications/summary')
          .set(auth(t.adminToken))
          .expect(200)
      ).body,
    ).toEqual({ new: 1 });
    // The admin gets an email (queued until email is set up).
    const outbox = (await t.http.get('/api/mail').set(auth(t.adminToken))).body;
    expect(JSON.stringify(outbox)).toContain('application');
  });

  it('a plain HTML form comes back to the academy site, never elsewhere', async () => {
    const ok = await t.http
      .post('/api/public/applications')
      .type('form')
      .send({
        fullName: 'Form Person',
        email: 'form@example.com',
        redirect: `${site}/thanks`,
      })
      .expect(303);
    expect(ok.headers.location).toBe(`${site}/thanks`);
    await t.http
      .post('/api/public/applications')
      .type('form')
      .send({
        fullName: 'Form Person',
        email: 'form2@example.com',
        redirect: 'https://evil.example/x',
      })
      .expect(201);
  });

  it('keeps nothing from bots, and slows floods', async () => {
    await t.http
      .post('/api/public/applications')
      .send({
        fullName: 'Bot',
        email: 'bot@example.com',
        website: 'http://spam',
      })
      .expect(201);
    const names = (
      await t.http.get('/api/applications').set(auth(t.adminToken)).expect(200)
    ).body.map((a: { fullName: string }) => a.fullName);
    expect(names).not.toContain('Bot');
    await t.http
      .post('/api/public/applications')
      .send({ fullName: 'X' })
      .expect(400);
    // 3 kept so far from this address; the limit is 5 in 10 minutes.
    for (let i = 0; i < 2; i++)
      await t.http
        .post('/api/public/applications')
        .send({ fullName: `Many ${i}`, email: `many${i}@example.com` })
        .expect(201);
    await t.http
      .post('/api/public/applications')
      .send({ fullName: 'One more', email: 'more@example.com' })
      .expect(429);
    // The website's server forwards with the shared key: past the limit.
    process.env.APPLICATIONS_KEY = 'site-key-for-tests';
    try {
      await t.http
        .post('/api/public/applications')
        .set('X-Site-Key', 'wrong')
        .send({ fullName: 'Wrong key', email: 'wrong@example.com' })
        .expect(429);
      await t.http
        .post('/api/public/applications')
        .set('X-Site-Key', 'site-key-for-tests')
        .send({
          fullName: 'From the site',
          email: 'site@example.com',
          source: 'website contact form',
        })
        .expect(201);
    } finally {
      delete process.env.APPLICATIONS_KEY;
    }
  });

  it('staff follow up: status and notes, logged; others cannot', async () => {
    const [first] = (
      await t.http
        .get('/api/applications?status=NEW')
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    const res = await t.http
      .patch(`/api/applications/${first.id}`)
      .set(auth(t.adminToken))
      .send({ status: 'CONTACTED', notes: 'Called on WhatsApp' })
      .expect(200);
    expect(res.body).toMatchObject({
      status: 'CONTACTED',
      notes: 'Called on WhatsApp',
    });
    const log = (
      await t.http
        .get(`/api/audit-logs?entityId=${first.id}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    expect(log[0].summary).toContain('New → Contacted');
    await t.http.get('/api/applications').expect(401);
  });
});
