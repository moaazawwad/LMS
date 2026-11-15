import { expect, test, type Page } from '@playwright/test';
import { accounts, acceptConfirms, menu, signIn, signOut } from './helpers';

/**
 * Asking the academy: a student asks to move a lesson, a teacher asks to
 * cancel one; staff answer and the answer shows on their pages.
 */
test.describe.configure({ mode: 'serial' });

async function openFirstUpcomingFromCalendar(page: Page) {
  await menu(page, 'Calendar').click();
  await page
    .getByRole('link', { name: /coming up$/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/lessons\/[0-9a-f-]+$/);
}

test('Aisha asks to move a lesson and Khaled asks to cancel one', async ({ page }) => {
  await signIn(page, accounts.aisha);
  await openFirstUpcomingFromCalendar(page);
  await page.getByRole('link', { name: 'Ask the academy' }).click();
  await page.getByLabel('Move it to another time').check();
  await page.getByLabel('Message').fill('We are travelling that week.');
  await page.getByLabel('Times that suit you').fill('The same week, any evening');
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByRole('status')).toContainText('Sent.');
  await page.getByRole('link', { name: 'Back to home' }).click();
  await expect(page.locator('section', { hasText: 'Your requests' })).toContainText(
    'Waiting for the academy',
  );
  await signOut(page);

  await signIn(page, 'khaled@academy.local');
  await page
    .locator('section', { has: page.getByRole('heading', { name: 'Coming up' }) })
    .getByRole('link')
    .first()
    .click();
  await page.getByRole('link', { name: 'Ask the academy to cancel or move' }).click();
  await expect(page.getByLabel('Cancel this lesson')).toBeChecked();
  // Teachers get 4 cancellations a month.
  await expect(page.getByText(/^0 of 4 cancellations used for /)).toBeVisible();
  await page.getByLabel('Message').fill('Family wedding, I cannot teach that day.');
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByRole('status')).toContainText('Sent.');
});

test('the admin sees both, moves Aisha’s lesson and gives Khaled’s student a makeup', async ({
  page,
}) => {
  await signIn(page, accounts.admin);
  await expect(
    page.getByRole('status').filter({ hasText: '2 requests are waiting' }),
  ).toBeVisible();
  await page
    .locator('aside nav')
    .getByRole('link', { name: /^Requests 2 open$/ })
    .click();

  const aisha = page.locator('article', { hasText: 'Aisha Karim' });
  await expect(aisha).toContainText('The same week, any evening');
  await aisha.getByRole('group', { name: 'Free times' }).getByRole('button').first().click();
  await aisha.getByLabel(/Reply to/).fill('Moved, have a good trip!');
  await aisha.getByRole('button', { name: 'Move to the chosen time' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'request was approved' })).toBeVisible();

  const khaled = page.locator('article', { hasText: 'Khaled Samir' });
  await khaled.getByRole('button', { name: 'Cancel, makeup owed' }).click();
  await expect(page.getByText('No open requests.')).toBeVisible();

  await page.getByRole('button', { name: 'Answered' }).click();
  await expect(page.locator('article')).toHaveCount(2);
  await expect(page.locator('article', { hasText: 'Aisha Karim' })).toContainText(
    'Moved, have a good trip!',
  );
});

test('Aisha sees the answer, and a declined request needs a reason', async ({ page }) => {
  acceptConfirms(page);
  await signIn(page, accounts.aisha);
  const mine = page.locator('section', { hasText: 'Your requests' });
  await expect(mine).toContainText('Approved');
  await expect(mine).toContainText('Moved, have a good trip!');

  // Ask again, then withdraw it.
  await openFirstUpcomingFromCalendar(page);
  await page.getByRole('link', { name: 'Ask the academy' }).click();
  await page.getByLabel('Message').fill('Actually, can I cancel this one too?');
  await page.getByRole('button', { name: 'Send request' }).click();
  await page.getByRole('link', { name: 'Back to home' }).click();
  await mine.getByRole('button', { name: 'Withdraw' }).click();
  await expect(mine).toContainText('Withdrawn');
});
