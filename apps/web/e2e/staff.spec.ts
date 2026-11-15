import { expect, test } from '@playwright/test';
import { accounts, menu, signIn, signOut } from './helpers';

const AREAS = ['Students', 'Teachers', 'Lessons & requests', 'Invoices', 'Curricula', 'Activity'];

test('admin limits a staff member to lessons; their menu and pages follow', async ({ page }) => {
  await signIn(page, accounts.admin);
  await menu(page, 'Staff & roles').click();
  const row = page.getByRole('row', { name: /staff@academy.local/ });
  await expect(row).toContainText('Everything');
  await row.getByRole('button', { name: /Change what/ }).click();
  const picks = page.getByRole('group', { name: /works on/ });
  for (const label of AREAS.filter((a) => a !== 'Lessons & requests')) {
    await picks.getByRole('checkbox', { name: new RegExp(`^${label}`) }).uncheck();
  }
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('now works on: lessons & requests');
  await expect(row).toContainText('Lessons & requests');
  await signOut(page);

  await signIn(page, accounts.staff);
  await expect(menu(page, 'Requests')).toBeVisible();
  await expect(menu(page, 'Invoices')).toHaveCount(0);
  // Without "Activity", the pages have no activity box.
  await expect(menu(page, 'Curricula & plans')).toHaveCount(0);
  await menu(page, 'Students').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Students');
  await expect(page.getByRole('region', { name: /^Activity/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add student' })).toHaveCount(0);
  // Typing the address of a page they don't have goes back to Today.
  await page.goto('/admin/invoices');
  await expect(page).toHaveURL(/\/admin\/today/);
  await signOut(page);

  // Back to everything, for the other tests.
  await signIn(page, accounts.admin);
  await menu(page, 'Staff & roles').click();
  await row.getByRole('button', { name: /Change what/ }).click();
  for (const label of AREAS)
    await picks.getByRole('checkbox', { name: new RegExp(`^${label}`) }).check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(row).toContainText('Everything');
});

test('a new staff member can be given only some areas', async ({ page }) => {
  await signIn(page, accounts.admin);
  await menu(page, 'Staff & roles').click();
  await page.getByLabel('Full name').fill('Nour Accounts');
  await page.getByLabel('Email').fill(`nour.${Date.now().toString(36)}@academy.local`);
  const picks = page.getByRole('group', { name: 'Works on' });
  for (const label of AREAS.filter((a) => a !== 'Invoices')) {
    await picks.getByRole('checkbox', { name: new RegExp(`^${label}`) }).uncheck();
  }
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Nour Accounts added');
  await expect(page.getByRole('row', { name: /Nour Accounts/ })).toContainText('Invoices');
});
