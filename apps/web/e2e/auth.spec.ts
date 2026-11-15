import { expect, test } from '@playwright/test';
import { accounts, menu, signIn } from './helpers';

test.describe('sign-in and roles', () => {
  const homes = [
    { who: 'admin', email: accounts.admin, url: /\/admin\/today$/ },
    { who: 'staff', email: accounts.staff, url: /\/admin\/today$/ },
    { who: 'teacher', email: accounts.ahmed, url: /\/teacher\/today$/ },
    { who: 'student', email: accounts.omar, url: /\/student\/home$/ },
  ];

  for (const { who, email, url } of homes) {
    test(`${who} lands on their own dashboard`, async ({ page }) => {
      await signIn(page, email);
      await expect(page).toHaveURL(url);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    });
  }

  test('a wrong password is refused with a message', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(accounts.admin);
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('staff do not get the Staff & roles page', async ({ page }) => {
    await signIn(page, accounts.staff);
    await expect(menu(page, 'Students')).toBeVisible();
    await expect(menu(page, 'Staff & roles')).toHaveCount(0);
    await page.goto('/admin/staff');
    await expect(page).not.toHaveURL(/\/admin\/staff/);
  });

  test('a student cannot open the admin area', async ({ page }) => {
    await signIn(page, accounts.omar);
    await page.goto('/admin/students');
    await expect(page).toHaveURL(/\/student\/home$/);
  });

  test('pages need a sign-in', async ({ page }) => {
    await page.goto('/admin/students');
    await expect(page).toHaveURL(/\/login/);
  });

  test('the security policy blocks nothing the app needs', async ({ page }) => {
    const violations: string[] = [];
    page.on('console', (m) => {
      if (/Content Security Policy|Refused to (load|apply|execute)/i.test(m.text()))
        violations.push(m.text());
    });
    await signIn(page, accounts.admin);
    await menu(page, 'Students').click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // The stylesheet applied (the menu is laid out as a column, not plain links).
    expect(await page.locator('aside').evaluate((el) => getComputedStyle(el).display)).toBe('flex');
    expect(violations).toEqual([]);
  });
});

test('forgot password: asks for the email, and an old link says to ask again', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot your password?' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Forgot your password?');
  await page.getByLabel('Email').fill(accounts.omar);
  await page.getByRole('button', { name: 'Send me a link' }).click();
  await expect(page.getByRole('status')).toContainText(
    `If there is an account for ${accounts.omar}, a link is on its way.`,
  );

  await page.goto('/reset-password?token=not-a-real-token-at-all-0123456789');
  await page.getByLabel('New password (8+ characters)').fill('Something-new-1');
  await page.getByLabel('The same password again').fill('Something-new-2');
  await page.getByRole('button', { name: 'Save password' }).click();
  await expect(page.getByRole('alert')).toHaveText('The two passwords are not the same.');
  await page.getByLabel('The same password again').fill('Something-new-1');
  await page.getByRole('button', { name: 'Save password' }).click();
  await expect(page.getByRole('alert')).toContainText('This link has expired or was already used.');
  await expect(page.getByRole('link', { name: 'Ask for a new link' })).toBeVisible();

  // The admin sees email is off on this server, and the link that was not sent.
  await signIn(page, accounts.admin);
  await menu(page, 'Settings').click();
  await expect(page.getByText('Email is off: nothing is sent yet.')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Latest emails' })).toContainText('Password link');
});
