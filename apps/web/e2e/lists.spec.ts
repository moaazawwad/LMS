import { expect, test } from '@playwright/test';
import { accounts, menu, signIn } from './helpers';

/** Finding people and entries on the admin lists. Read-only. */
test.beforeEach(async ({ page }) => {
  await signIn(page, accounts.admin);
});

test('filters students by plan, teacher and name', async ({ page }) => {
  await menu(page, 'Students').click();
  const rows = page.locator('tbody tr');
  await expect(rows.first()).toContainText('@');

  // Other tests may add Basic students too; the seeded one is Mariam.
  await page.getByLabel('Plan').selectOption('BASIC');
  await expect(rows.filter({ hasText: 'Mariam Ali' })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'Omar Siddiqui' })).toHaveCount(0);
  await expect(page.getByRole('status').first()).toContainText(/\d+ of/);

  await page.getByLabel('Plan').selectOption('');
  await page.getByLabel('Teacher').selectOption('Mona Fathy');
  await expect(rows.first()).toContainText('Aisha Karim');

  await page.getByLabel('Teacher').selectOption('');
  await page.getByLabel('Search').fill('OMAR');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('omar@academy.local');

  await page.getByLabel('Search').fill('nobody-like-this');
  await expect(page.getByText('No students found.')).toBeVisible();
});

test('filters teachers by level and curriculum', async ({ page }) => {
  await menu(page, 'Teachers').click();
  const rows = page.getByRole('region', { name: 'Teacher list' }).locator('tbody tr');
  await page.getByLabel('Level').selectOption('PREMIUM');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Mona Fathy');

  await page.getByLabel('Level').selectOption('');
  await page.getByLabel('Teaches').selectOption('Reading 1');
  await expect(rows.filter({ hasText: 'Ahmed Hassan' })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'Khaled Samir' })).toHaveCount(0);
});

test('each page has its own activity, newest first', async ({ page }) => {
  // There is no separate log page any more.
  await expect(menu(page, 'Activity log')).toHaveCount(0);

  // Omar's page: his own history, e.g. the lesson he cancelled himself.
  await menu(page, 'Students').click();
  await page.getByRole('table').getByRole('link', { name: 'Omar Siddiqui' }).click();
  const omar = page.getByRole('region', { name: 'Activity', exact: true });
  await expect(omar.locator('li').first()).not.toContainText('Loading');
  if (await omar.getByRole('button', { name: 'Show older' }).isVisible())
    await omar.getByRole('button', { name: 'Show older' }).click();
  await expect(omar).toContainText('credit to next invoice');
  await expect(omar).not.toContainText('Aisha Karim');

  // The Lessons page: only lesson actions.
  await menu(page, 'Lessons').click();
  const lessons = page.getByRole('region', { name: 'Activity on lessons' });
  await expect(lessons.locator('li').first()).not.toContainText('Loading');
  await expect(lessons).not.toContainText('Invoice paid');
});

test("opens a teacher's and a student's month", async ({ page }) => {
  await menu(page, 'Teachers').click();
  await page.getByRole('link', { name: 'Ahmed Hassan' }).first().click();
  await page.getByRole('link', { name: 'Calendar' }).click();
  await expect(page.getByText('Ahmed Hassan · Cairo time')).toBeVisible();
  await page
    .getByRole('link', { name: /Omar Siddiqui, coming up$/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Omar Siddiqui');

  await menu(page, 'Students').click();
  await page.getByRole('link', { name: 'Aisha Karim' }).first().click();
  await page.getByRole('link', { name: 'Calendar' }).click();
  await expect(page.getByText('Aisha Karim · Australia/Sydney time')).toBeVisible();
  await expect(page.getByRole('link', { name: /coming up$/ }).first()).toBeVisible();
});

test("a student's page has their teacher's meeting link to copy", async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await menu(page, 'Students').click();
  await page.getByRole('link', { name: 'Omar Siddiqui' }).first().click();
  const box = page.getByRole('group', { name: "Teacher's meeting link" });
  await expect(box).toContainText('https://zoom.us/j/');
  await box.getByRole('button', { name: 'Copy link' }).click();
  await expect(box.getByRole('button', { name: 'Copied' })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/^https:\/\/zoom\.us\/j\/\d+$/);
});

test('finds a person from anywhere with the quick search', async ({ page }) => {
  await menu(page, 'Invoices').click();
  await page.keyboard.press('Control+k');
  const find = page.getByRole('combobox', { name: 'Find a person' });
  await expect(find).toBeFocused();
  await find.fill('omar');
  const list = page.getByRole('listbox', { name: 'People found' });
  await expect(list.getByRole('option').first()).toContainText('Omar Siddiqui');
  await expect(list.getByRole('option').first()).toContainText('with ');
  await find.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Omar Siddiqui' })).toBeVisible();
  await expect(page.getByRole('group', { name: "Teacher's meeting link" })).toBeVisible();

  await find.fill('mona');
  await page.getByRole('option', { name: /Mona Fathy/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Mona Fathy' })).toBeVisible();
});

test('the Actions menu on a student row opens what you need', async ({ page }) => {
  await menu(page, 'Students').click();
  await page.getByRole('button', { name: 'Actions for Omar Siddiqui' }).click();
  const actions = page.getByRole('menu');
  for (const item of [
    'View profile',
    'View calendar',
    'Add a lesson',
    'Reschedule a lesson',
    'Cancel a lesson',
    'Transfer',
    'Reset password',
  ])
    await expect(actions.getByRole('menuitem', { name: item, exact: true })).toBeVisible();
  // Booking weekly lessons or a trial is part of "Add a lesson".
  await expect(actions.getByRole('menuitem', { name: 'Book a trial lesson' })).toHaveCount(0);

  // Cancel asks which lesson, then opens the usual dialog on the Cancel tab.
  await actions.getByRole('menuitem', { name: 'Cancel a lesson' }).click();
  const pick = page.getByRole('dialog', { name: 'Cancel which lesson?' });
  await pick.getByRole('button').nth(1).click();
  await expect(page.getByRole('tab', { name: 'Cancel' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');

  // Transfer opens its own page: for good or for some lessons, and a teacher search.
  await page.getByRole('button', { name: 'Actions for Omar Siddiqui' }).click();
  await page.getByRole('menuitem', { name: 'Transfer', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Transfer' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /For good/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByRole('combobox', { name: 'Find a teacher' })).toBeVisible();
  // Nothing else here: adding lessons has its own action.
  await expect(page.getByRole('button', { name: /Add/ })).toHaveCount(0);
});

test('the Actions menu on a teacher row', async ({ page }) => {
  await menu(page, 'Teachers').click();
  await page.getByRole('button', { name: 'Actions for Mona Fathy' }).click();
  await page.getByRole('menuitem', { name: 'Reset password' }).click();
  await expect(page.getByRole('dialog')).toContainText('Mona Fathy');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Actions for Mona Fathy' }).click();
  await page.getByRole('menuitem', { name: 'View calendar' }).click();
  await expect(page).toHaveURL(/\/admin\/teachers\/[^/]+\/calendar$/);
});

test('the Lessons page lists lessons by kind and opens one with its history', async ({ page }) => {
  await menu(page, 'Lessons').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Lessons' })).toBeVisible();
  const table = page.getByRole('table', { name: 'Lessons' });
  await expect(table.locator('tbody tr').first()).not.toContainText('Loading');

  // Omar cancelled a lesson of his first cycle.
  await page.getByRole('tab', { name: 'Cancelled' }).click();
  const omar = table.locator('tbody tr', { hasText: 'Omar Siddiqui' }).first();
  await expect(omar).toContainText('Cancelled');
  await omar.getByRole('link', { name: /^Open lesson/ }).click();

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Cairo');
  await expect(page.getByRole('region', { name: 'People and link' })).toContainText(
    'Omar Siddiqui',
  );
  await expect(page.getByRole('region', { name: 'History' })).toContainText('Cancelled');
  await expect(page.getByRole('region', { name: 'Billing' })).toContainText('INV-');
  await expect(page.getByRole('region', { name: 'Activity' })).toContainText('Cancelled');
});
