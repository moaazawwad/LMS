import { expect, test } from '@playwright/test';
import { acceptConfirms, accounts, menu, showMonthWithDoneLessons, signIn } from './helpers';

/**
 * Self-service rules from the student side. The seed books lessons from
 * today, so the first lesson may be less than 4 hours away: the tests always
 * use the first lesson whose buttons are open.
 */

test('Omar (Standard) moves a lesson to a free time and loses one reschedule', async ({ page }) => {
  await signIn(page, accounts.omar);
  const reschedulesLeft = page
    .locator('section', { hasText: 'Your plan' })
    .locator('.kv', { hasText: 'Reschedules left' });
  await expect(reschedulesLeft).toContainText('2 of 2');

  await page.locator('a.btn:not(.disabled)', { hasText: 'Reschedule' }).first().click();
  await expect(page.getByRole('heading', { name: 'Move your lesson' })).toBeVisible();

  // Walk the days until one has a free time. After each click, wait until that
  // day is the selected one and its own answer is on screen (times, or none).
  const days = page.getByRole('group', { name: 'Day' }).getByRole('button');
  const timeGroup = page.getByRole('group', { name: 'Time' });
  const times = timeGroup.getByRole('button');
  const dayCount = await days.count();
  for (let i = 0; i < dayCount; i++) {
    await days.nth(i).click();
    await expect(days.nth(i)).toHaveAttribute('aria-pressed', 'true');
    await expect(times.first().or(timeGroup.getByText('No free time on this day.'))).toBeVisible();
    if ((await times.count()) > 0) break;
  }
  await times.first().click();
  await page.getByRole('button', { name: 'Confirm new time' }).click();
  await expect(page.getByRole('status')).toContainText('Done. Your lesson is now');

  await page.getByRole('link', { name: 'Back home' }).click();
  await expect(reschedulesLeft).toContainText('1 of 2');
});

test('Mariam (Basic) cancels once, then cancelling online is closed', async ({ page }) => {
  acceptConfirms(page);
  await signIn(page, accounts.mariam);
  const cancel = page.getByRole('button', { name: 'Cancel', exact: true });

  await cancel.and(page.locator(':enabled')).first().click();
  await expect(page.getByRole('status')).toContainText('Lesson cancelled');

  // Basic has one cancel per cycle.
  await expect(page.getByText("You've used all cancellations this cycle")).toBeVisible();
  for (const button of await cancel.all()) await expect(button).toBeDisabled();
  await expect(
    page.locator('section', { hasText: 'Your plan' }).locator('.kv', { hasText: 'Lesson credits' }),
  ).toContainText('1 off next invoice');
});

test('Omar reads what his teacher wrote and his homework, newest first', async ({ page }) => {
  await signIn(page, accounts.omar);
  // Home shows the newest homework.
  await expect(
    page.locator('section', { has: page.getByRole('heading', { name: 'Homework' }) }),
  ).toContainText('Finish the story');
  await expect(
    page
      .locator('section', { has: page.getByRole('heading', { name: 'Homework' }) })
      .getByRole('link', { name: /Send your answer|change your answer|Read your teacher's reply/ }),
  ).toBeVisible();

  await menu(page, 'Lessons & homework').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Lessons & homework' })).toBeVisible();
  const lessons = page.locator('article');
  await expect(lessons.filter({ hasText: 'Unit 1 vocabulary' })).toContainText(
    'Learn the 12 words on page 4.',
  );
  await expect(lessons.filter({ hasText: 'Cancelled · student' })).toHaveCount(1);
  // The last lesson of the past cycle has no notes yet.
  await expect(
    lessons.filter({ hasText: 'Your teacher has not added notes yet.' }).first(),
  ).toBeVisible();

  await page.getByRole('button', { name: 'With homework' }).click();
  await expect(lessons).toHaveCount(6);
  await expect(lessons.first()).toContainText('Finish the story');

  // Each homework says where it stands: Omar answered two of them.
  await expect(
    lessons
      .filter({ hasText: 'Workbook page 6' })
      .getByRole('link', { name: 'Checked: read the reply' }),
  ).toBeVisible();
  await expect(
    lessons
      .filter({ hasText: 'Describe a photo' })
      .getByRole('link', { name: 'Sent: waiting for a reply' }),
  ).toBeVisible();
  await lessons.filter({ hasText: 'Numbers practice' }).getByRole('link').first().click();
  await expect(page).toHaveURL(/\/student\/lessons\/[0-9a-f-]+$/);
  await expect(
    page.locator('section', { has: page.getByRole('heading', { name: 'Homework' }) }),
  ).toContainText('Write the numbers 1 to 20 in words.');
});

test('a lesson in the calendar opens its page', async ({ page }) => {
  await signIn(page, accounts.omar);
  await menu(page, 'Calendar').click();
  await showMonthWithDoneLessons(page);
  await page
    .getByRole('link', { name: /9:00 AM, done/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/student\/lessons\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { level: 2, name: 'What you covered' })).toBeVisible();
});

test('Omar sees what he owes and opens the invoice with its credit', async ({ page }) => {
  await signIn(page, accounts.omar);
  await menu(page, 'Invoices').click();
  await expect(page.getByRole('status')).toContainText('Due now: $70.00');
  await page.locator('tbody tr', { hasText: 'due' }).getByRole('link').click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Invoice INV-');
  await expect(page.getByRole('row', { name: /Credit for cancelled lessons/ })).toContainText(
    '−$10.00',
  );
  await expect(page.getByText('Total due')).toBeVisible();
  await expect(page.locator('dd.grand')).toHaveText('$70.00');
  // Every lesson of the cycle is listed with a number.
  await expect(page.getByRole('table').last().locator('tbody tr')).not.toHaveCount(0);
});
