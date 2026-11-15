import { expect, test } from '@playwright/test';
import { accounts, signIn } from './helpers';

/** Every main page fits a phone screen without sideways scrolling. */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const pages = [
  {
    email: accounts.admin,
    paths: [
      '/admin/today',
      '/admin/students',
      '/admin/teachers',
      '/admin/invoices',
      '/admin/reports',
      '/admin/catalog',
      '/admin/staff',
      '/admin/settings',
      '/admin/students/new',
      '/admin/teachers/import',
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
  { email: accounts.youssef, paths: ['/student/lessons', '/student/invoices'] },
];

for (const { email, paths } of pages) {
  test(`fits a phone: ${email.split('@')[0]}`, async ({ page }) => {
    await signIn(page, email);
    for (const path of paths) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(width, `${path} scrolls sideways`).toBeLessThanOrEqual(390);
    }
  });
}
