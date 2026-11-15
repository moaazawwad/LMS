import { FIRST_ADMIN_MIN_PASSWORD, firstAdminFromEnv } from './first-admin.js';

describe('first admin from the server settings', () => {
  const password = 'x'.repeat(FIRST_ADMIN_MIN_PASSWORD);

  it('does nothing when not asked', () => {
    expect(firstAdminFromEnv({})).toBeNull();
  });

  it('reads email, password and an optional name', () => {
    expect(
      firstAdminFromEnv({
        ADMIN_EMAIL: ' Owner@Academy.com ',
        ADMIN_PASSWORD: password,
        ADMIN_NAME: 'Moaaz',
      }),
    ).toEqual({
      email: 'owner@academy.com',
      password,
      fullName: 'Moaaz',
    });
    expect(
      firstAdminFromEnv({
        ADMIN_EMAIL: 'owner@academy.com',
        ADMIN_PASSWORD: password,
      }),
    ).toMatchObject({ fullName: 'Admin' });
  });

  it('says what is missing or wrong', () => {
    expect(firstAdminFromEnv({ ADMIN_EMAIL: 'owner@academy.com' })).toEqual({
      problem: expect.stringContaining('both'),
    });
    expect(firstAdminFromEnv({ ADMIN_PASSWORD: password })).toEqual({
      problem: expect.stringContaining('both'),
    });
    expect(
      firstAdminFromEnv({ ADMIN_EMAIL: 'owner', ADMIN_PASSWORD: password }),
    ).toEqual({ problem: expect.stringContaining('email') });
    expect(
      firstAdminFromEnv({
        ADMIN_EMAIL: 'owner@academy.com',
        ADMIN_PASSWORD: 'short',
      }),
    ).toEqual({
      problem: expect.stringContaining(
        `${FIRST_ADMIN_MIN_PASSWORD} characters`,
      ),
    });
  });
});
