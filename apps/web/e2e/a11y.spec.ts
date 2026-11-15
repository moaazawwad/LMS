import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { accounts, menu, signIn } from './helpers';

/**
 * Automatic accessibility checks (WCAG 2.1 A and AA rules that a tool can
 * judge: names, labels, contrast, structure) on every main page.
 */
const pages = [
  {
    email: accounts.admin,
    paths: [
      '/admin/today',
      '/admin/students',
      '/admin/students/new',
      '/admin/students/import',
      '/admin/teachers',
      '/admin/requests',
      '/admin/invoices',
      '/admin/reports',
      '/admin/catalog',
      '/admin/staff',
      '/admin/settings',
    ],
  },
  {
    email: accounts.ahmed,
    paths: ['/teacher/today', '/teacher/calendar', '/teacher/history', '/teacher/settings'],
  },
  {
    email: accounts.omar,
    paths: [
      '/student/home',
      '/student/lessons',
      '/student/calendar',
      '/student/invoices',
      '/student/settings',
    ],
  },
];

async function check(page: Page, where: string) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const problems = result.violations.map(
    (v) =>
      `${where}: ${v.id} (${v.impact}) ${v.help}\n    ${v.nodes
        .map((n) => n.target.join(' '))
        .slice(0, 5)
        .join('\n    ')}`,
  );
  expect(problems, problems.join('\n')).toEqual([]);
}

test('the sign-in page', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await check(page, '/login');
});

for (const { email, paths } of pages) {
  test(`pages for ${email.split('@')[0]}`, async ({ page }) => {
    // Many pages in one test.
    test.setTimeout(90_000);
    await signIn(page, email);
    for (const path of paths) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.waitForLoadState('networkidle');
      await check(page, path);
    }
  });
}

test('detail pages', async ({ page }) => {
  await signIn(page, accounts.admin);
  await menu(page, 'Students').click();
  await page.getByRole('link', { name: 'Omar Siddiqui' }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await check(page, 'student page');
  await page.getByRole('link', { name: 'Manage subscription' }).click();
  await page.getByRole('button', { name: /Change weekly times/ }).click();
  await expect(
    page.getByRole('region', { name: 'Free every week with this teacher' }),
  ).toBeVisible();
  await check(page, 'subscription page');
  await menu(page, 'Teachers').click();
  await page.getByRole('link', { name: 'Ahmed Hassan' }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await check(page, 'teacher page');
  await page.getByRole('link', { name: 'Weekly hours' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await check(page, 'weekly hours');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await signIn(page, accounts.omar);
  await menu(page, 'Lessons & homework').click();
  await expect(page.locator('article h2 a').first()).toBeVisible();
  await page.locator('article h2 a').first().click();
  await expect(page).toHaveURL(/\/student\/lessons\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { level: 2, name: 'What you covered' })).toBeVisible();
  await check(page, 'student lesson page');
  await page.goto(page.url().replace('/lessons/', '/ask/'));
  await expect(page.getByRole('heading', { name: 'Ask the academy' })).toBeVisible();
  await check(page, 'ask page');
  await menu(page, 'Invoices').click();
  await page.locator('tbody a').first().click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Invoice');
  await check(page, 'invoice page');
});
