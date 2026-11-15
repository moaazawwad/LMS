/**
 * A new deployment gets its first admin from the server settings, once.
 * WIPES the database at TEST_DATABASE_URL.
 */
import pg from 'pg';
import { FirstAdminService } from '../src/auth/first-admin.js';
import {
  auth,
  PASSWORD,
  startApp,
  type TestApp,
  testDbUrl,
} from './helpers.js';

const suite = testDbUrl ? describe : describe.skip;

suite('first admin (e2e)', () => {
  let t: TestApp;
  let pool: pg.Pool;
  const settings = {
    ADMIN_EMAIL: 'Owner@Academy.test',
    ADMIN_PASSWORD: 'a-long-first-password',
    ADMIN_NAME: 'Owner',
  };

  beforeAll(async () => {
    t = await startApp();
    pool = new pg.Pool({ connectionString: testDbUrl });
  });

  afterAll(async () => {
    await pool?.end();
    await t?.app.close();
  });

  it('does nothing while an admin exists', async () => {
    expect(await t.app.get(FirstAdminService).ensure(settings)).toBe('exists');
    expect(await t.app.get(FirstAdminService).ensure({})).toBe('not-set');
  });

  it('creates the first admin when there is none, and only once', async () => {
    // A brand-new deployment: no admin yet.
    await pool.query(
      `update users set role = 'STAFF' where email = 'admin@test.local'`,
    );
    expect(await t.app.get(FirstAdminService).ensure(settings)).toBe('created');
    expect(await t.app.get(FirstAdminService).ensure(settings)).toBe('exists');

    const login = await t.http
      .post('/api/auth/login')
      .send({ email: 'owner@academy.test', password: settings.ADMIN_PASSWORD })
      .expect(200);
    const me = (
      await t.http
        .get('/api/auth/me')
        .set(auth(login.body.accessToken))
        .expect(200)
    ).body;
    expect(me).toMatchObject({ role: 'ADMIN', fullName: 'Owner' });

    const logs = (
      await t.http
        .get('/api/audit-logs?action=user.first-admin')
        .set(auth(login.body.accessToken))
        .expect(200)
    ).body;
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actorKind: 'SYSTEM' });
    expect(JSON.stringify(logs)).not.toContain(settings.ADMIN_PASSWORD);
  });

  it('refuses an email another account already has', async () => {
    await pool.query(`update users set role = 'STAFF' where role = 'ADMIN'`);
    expect(
      await t.app.get(FirstAdminService).ensure({
        ADMIN_EMAIL: 'admin@test.local',
        ADMIN_PASSWORD: 'another-long-password',
      }),
    ).toContain('already exists');
    // The old password still works for that account.
    await t.http
      .post('/api/auth/login')
      .send({ email: 'admin@test.local', password: PASSWORD })
      .expect(200);
  });
});
