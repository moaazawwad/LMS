import { expect, test } from '@playwright/test';
import { accounts, menu, signIn, signOut } from './helpers';

test('the monthly report shows money, lessons and the last six months', async ({ page }) => {
  await signIn(page, accounts.admin);
  await menu(page, 'Reports').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible();
  const money = page.getByRole('region', { name: 'Money' });
  await expect(money).toContainText('Invoiced this month');
  await expect(money).toContainText('Due now');
  await expect(page.getByRole('region', { name: 'Lessons' })).toContainText('Held');
  await expect(page.getByRole('region', { name: 'Teacher pay' })).toContainText(
    'Earned this month',
  );
  const trend = page.getByRole('table', { name: 'Last 6 months' });
  await expect(trend.locator('tbody tr')).toHaveCount(6);

  // Omar's finished cycle was paid last month or this one: something was collected in the six months.
  await expect(trend).toContainText(/\$[1-9]/);

  await page.getByRole('button', { name: 'Previous month' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next month' })).toBeEnabled();
  await signOut(page);

  // Staff see the numbers but not teacher pay.
  await signIn(page, accounts.staff);
  await menu(page, 'Reports').click();
  await expect(page.getByRole('region', { name: 'Money' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Teacher pay' })).toHaveCount(0);
});
