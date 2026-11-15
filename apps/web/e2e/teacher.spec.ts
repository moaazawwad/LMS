import { expect, test } from '@playwright/test';
import { accounts, menu, showMonthWithDoneLessons, signIn, unique } from './helpers';

test('Ahmed writes notes and homework for an upcoming lesson, and they are kept', async ({
  page,
}) => {
  const id = unique();
  await signIn(page, accounts.ahmed);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Today, Ahmed');

  const comingUp = page.locator('section', {
    has: page.getByRole('heading', { name: 'Coming up' }),
  });
  await comingUp.getByRole('link').first().click();
  await expect(page).toHaveURL(/\/teacher\/lessons\//);

  await page.getByLabel('What you covered').fill(`Reviewed unit 3 (${id})`);
  await page.getByLabel('Title').fill(`Workbook page 12 (${id})`);
  await page.getByLabel('Instructions').fill('Exercises 1 to 4.');
  await page.getByRole('button', { name: 'Save notes and homework' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Notes and homework saved.' }),
  ).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('What you covered')).toHaveValue(`Reviewed unit 3 (${id})`);
  await expect(page.getByLabel('Title')).toHaveValue(`Workbook page 12 (${id})`);
});

test('a teacher only sees their own lessons', async ({ page }) => {
  await signIn(page, accounts.ahmed);
  // Mariam is Khaled's student.
  await expect(page.getByText('Mariam')).toHaveCount(0);
});

test('Ahmed finds the past lessons still missing notes and catches up', async ({ page }) => {
  await signIn(page, accounts.ahmed);
  await menu(page, 'Past lessons').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Past lessons' })).toBeVisible();

  const filter = page.getByRole('checkbox', { name: /Only lessons without notes/ });
  await expect(page.locator('tbody tr').first()).toContainText('Omar Siddiqui');
  const before = Number((await filter.locator('xpath=..').innerText()).match(/\((\d+)\)/)?.[1]);
  expect(before).toBeGreaterThan(0);

  await filter.check();
  await expect(page.getByRole('link', { name: 'Add notes' })).toHaveCount(before);
  await page.getByRole('link', { name: 'Add notes' }).first().click();
  await expect(page.getByRole('link', { name: 'Past lessons' }).first()).toBeVisible();
  await page.getByLabel('What you covered').fill('Unit 4: food and drinks.');
  await page.getByRole('button', { name: 'Save notes and homework' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Notes and homework saved.' }),
  ).toBeVisible();

  await page
    .getByRole('navigation', { name: 'Breadcrumb' })
    .getByRole('link', { name: 'Past lessons' })
    .click();
  await expect(
    page.getByRole('checkbox', { name: /Only lessons without notes/ }).locator('xpath=..'),
  ).toContainText(`(${before - 1})`);
});

test("Ahmed's calendar shows his students' lessons on Cairo time", async ({ page }) => {
  await signIn(page, accounts.ahmed);
  await menu(page, 'Calendar').click();
  await expect(page.getByText('Cairo time')).toBeVisible();
  await showMonthWithDoneLessons(page);
  await page
    .getByRole('link', { name: /Omar Siddiqui, done/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/teacher\/lessons\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: 'Attendance' })).toBeVisible();
});

test('Ahmed sees how many lessons count for him this month and what they come to', async ({
  page,
}) => {
  await signIn(page, accounts.ahmed);
  await menu(page, 'Past lessons').click();
  const month = page.getByRole('region', { name: 'Your month' });
  await expect(month).toContainText('lessons that count for you');
  // His own pay only: hours x his level's rate.
  await expect(month.getByTestId('my-pay')).toContainText(/EGP/);
  await expect(month.getByTestId('my-pay')).toContainText('an hour');
  // Omar's finished cycle started 28 days ago: this month or the one before has held lessons.
  const counted = async () => Number(await month.locator('.big').first().innerText());
  let total = await counted();
  await month.getByRole('button', { name: 'Previous month' }).click();
  await expect(month.getByRole('button', { name: 'Next month' })).toBeEnabled();
  total += await counted();
  expect(total).toBeGreaterThan(0);
});
