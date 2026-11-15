import { expect, type Page, test } from '@playwright/test';
import { accounts, menu, signIn } from './helpers';

/**
 * After the lesson. Youssef's finished cycle (seed) has a lesson he missed,
 * one his teacher did not enter, one nobody entered, and a billed extra lesson.
 * Runs in order: the teacher and student look first, then the admin decides.
 */
test.describe.configure({ mode: 'serial' });

/** A date (YYYY-MM-DD) for the next Monday at least two days away. */
function nextMonday() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 2);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function checkRow(page: Page, recorded: string) {
  return page.locator('#attendance li', { hasText: 'Youssef Nabil' }).filter({ hasText: recorded });
}

test('Mona sees that a lesson she did not enter does not count for her yet', async ({ page }) => {
  await signIn(page, accounts.mona);
  await menu(page, 'Past lessons').click();
  const row = page.locator('tbody tr', { hasText: "Teacher didn't enter" }).first();
  await expect(row).toContainText('Youssef Nabil');
  await row.getByRole('link', { name: 'Details' }).click();
  await expect(
    page.getByText('You did not press Enter class, so this lesson does not count for you'),
  ).toBeVisible();

  // A lesson the student missed still counts for her, and needs no notes.
  await page.goBack();
  const absent = page.locator('tbody tr', { hasText: 'Student absent' }).first();
  await expect(absent.getByRole('link', { name: 'Add notes' })).toHaveCount(0);
});

test('Youssef sees what happened and pays for his extra lesson', async ({ page }) => {
  await signIn(page, accounts.youssef);
  await menu(page, 'Lessons & homework').click();
  const missed = page.locator('article', { hasText: 'Student absent' }).first();
  await expect(missed).toBeVisible();
  await expect(missed.getByText('What you covered')).toHaveCount(0);
  await missed.getByRole('heading', { level: 2 }).getByRole('link').click();
  await expect(page.getByText('You did not enter this lesson. It counts as taken.')).toBeVisible();

  await menu(page, 'Invoices').click();
  await page.locator('tbody tr', { hasText: 'paid' }).getByRole('link').click();
  const extra = page.locator('tbody tr', { hasText: 'Extra lessons' });
  await expect(extra).toBeVisible();
  await expect(extra.locator('td').nth(1)).toHaveText('1');
});

test('the admin settles what happened: absent student, nobody came, teacher absent with a makeup', async ({
  page,
}) => {
  await signIn(page, accounts.admin);
  await expect(page.getByRole('heading', { name: 'Attendance to check' })).toBeVisible();
  await expect(page.locator('#attendance li', { hasText: 'Youssef Nabil' })).toHaveCount(3);

  const nobody = checkRow(page, 'Nobody pressed Enter class');
  await nobody.getByRole('button', { name: 'Nobody came' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Saved for Youssef Nabil' }),
  ).toContainText('nobody came');

  await checkRow(page, 'The teacher entered, the student did not')
    .getByRole('button', { name: 'OK, student absent' })
    .click();
  await expect(page.locator('#attendance li', { hasText: 'Youssef Nabil' })).toHaveCount(1);

  await checkRow(page, 'The student entered, the teacher did not')
    .getByRole('button', { name: 'Teacher absent · makeup' })
    .click();
  await expect(page.locator('#attendance li', { hasText: 'Youssef Nabil' })).toHaveCount(0);
  await expect(page.locator('#makeups li', { hasText: 'Youssef Nabil' })).toHaveCount(1);

  // Book the makeup straight from the notice: "Add a lesson", one lesson, a makeup.
  await page.getByRole('link', { name: 'Book the makeup' }).click();
  await expect(page.getByRole('radio', { name: /One lesson/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByRole('radio', { name: /Same teacher/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByLabel('Why')).toHaveValue('MAKEUP');
  await expect(page.getByLabel('Replaces')).not.toHaveValue('');
  await page.getByLabel('Day (Europe/London)').fill(nextMonday());
  await page.getByLabel('Day (Europe/London)').press('Enter');
  // Pick one of Mona's free times that day.
  const free = page
    .getByRole('group', { name: 'Free times that day' })
    .getByRole('button', { name: /^3:00 PM/ });
  await free.click();
  await expect(free).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Add lesson' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Makeup lesson added.' })).toBeVisible();

  await menu(page, 'Today').click();
  await expect(page.locator('#makeups li', { hasText: 'Youssef Nabil' })).toHaveCount(0);
});

test("the student's page shows who settled each lesson", async ({ page }) => {
  await signIn(page, accounts.admin);
  await menu(page, 'Students').click();
  await page.getByRole('table').getByRole('link', { name: 'Youssef Nabil' }).click();
  const log = page.getByRole('region', { name: 'Activity', exact: true });
  const checked = log.locator('li', { hasText: 'Attendance checked' });
  await expect(checked).toHaveCount(3);
  await expect(checked.filter({ hasText: 'makeup lesson owed' })).toHaveCount(1);
  await expect(checked.filter({ hasText: 'nobody came' })).toHaveCount(1);
  // Each entry says who did it.
  await expect(checked.first()).toContainText('by Academy Admin');
});

test('the teachers page counts the lessons to pay', async ({ page }) => {
  await signIn(page, accounts.admin);
  await menu(page, 'Teachers').click();
  const card = page.locator('section', {
    has: page.getByRole('heading', { name: 'Lessons to pay' }),
  });
  await expect(card).toBeVisible();
  // Youssef's cycle is the 28 days before today: this month, the previous one, or both.
  const mona = card.locator('tbody tr', { hasText: 'Mona Fathy' });
  // Wait for this month's answer (her row, or none) before deciding to go back.
  await expect(mona.or(card.getByText('No finished lessons this month.')).first()).toBeVisible();
  if ((await mona.count()) === 0)
    await card.getByRole('button', { name: 'Previous month' }).click();
  await expect(mona).toBeVisible();
  // Admins see the pay: hours x Mona's rate (300 EGP an hour in the demo).
  await expect(card.getByRole('columnheader', { name: 'Pay', exact: true })).toBeVisible();
  await expect(mona).toContainText('EGP 300.00');
  await expect(card.getByRole('button', { name: 'Next month' })).toBeVisible();
});

test('the admin sets pay per hour by level, and a teacher can have their own', async ({ page }) => {
  await signIn(page, accounts.admin);
  await menu(page, 'Teachers').click();
  const levels = page.locator('section', {
    has: page.getByRole('heading', { name: 'Pay per hour by level' }),
  });
  const premium = levels.getByLabel('Premium', { exact: true });
  await expect(premium).toHaveValue('300');
  await expect(levels).toContainText('1 teacher');
  await premium.fill('350');
  await levels.getByRole('button', { name: 'Save rates' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Premium EGP 350.00' })).toBeVisible();

  const card = page.locator('section', {
    has: page.getByRole('heading', { name: 'Lessons to pay' }),
  });
  const mona = card.locator('tbody tr', { hasText: 'Mona Fathy' });
  await expect(mona.or(card.getByText('No finished lessons this month.')).first()).toBeVisible();
  if ((await mona.count()) === 0)
    await card.getByRole('button', { name: 'Previous month' }).click();
  await expect(mona).toContainText('EGP 350.00');

  // Her page says where the rate comes from; the edit form says what empty means.
  await page.getByRole('link', { name: 'Mona Fathy' }).first().click();
  await page.getByRole('tab', { name: 'Pay & bank' }).click();
  await expect(page.getByText('EGP 350.00 an hour (Premium level rate)')).toBeVisible();
  await page.getByRole('link', { name: 'Edit' }).first().click();
  await expect(
    page.getByText("Leave empty to pay the Premium level's rate: EGP 350.00"),
  ).toBeVisible();

  // Put the demo rate back for the other tests.
  await menu(page, 'Teachers').click();
  await levels.getByLabel('Premium', { exact: true }).fill('300');
  await levels.getByRole('button', { name: 'Save rates' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Premium EGP 300.00' })).toBeVisible();
});

test('the admin records a teacher as paid for the month, and can undo it', async ({ page }) => {
  await signIn(page, accounts.admin);
  await menu(page, 'Teachers').click();
  const card = page.locator('section', {
    has: page.getByRole('heading', { name: 'Lessons to pay' }),
  });
  const mona = card.locator('tbody tr', { hasText: 'Mona Fathy' });
  await expect(mona.or(card.getByText('No finished lessons this month.')).first()).toBeVisible();
  if ((await mona.count()) === 0)
    await card.getByRole('button', { name: 'Previous month' }).click();

  await mona.getByRole('button', { name: 'Mark Mona Fathy paid' }).click();
  const dialog = page.getByRole('dialog', { name: /Pay Mona Fathy for/ });
  await expect(dialog).toContainText('EGP 300.00 an hour');
  await dialog.getByRole('button', { name: 'Record as paid' }).click();
  // Lessons still to check, or a month not over yet: pay anyway, with a note.
  // (A finished month with nothing to check, e.g. early in a month, records straight away.)
  // The reason shows at the top of the screen, and the dialog offers to pay anyway.
  const anyway = dialog.getByRole('button', { name: 'Pay anyway' });
  const paid = page.getByRole('status').filter({ hasText: "Mona Fathy's" });
  await expect(anyway.or(paid).first()).toBeVisible();
  if (await anyway.isVisible()) {
    await expect(page.getByRole('alert').filter({ hasText: 'Not done' })).toContainText(
      /still need checking|is not over yet/,
    );
    await dialog.getByLabel(/Note/).fill('Paid by bank transfer, ref 2231');
    await anyway.click();
  }
  await expect(dialog).toBeHidden();
  await expect(paid).toBeVisible();
  await expect(mona).toContainText(/paid \w{3} \d+/);

  await mona.getByRole('button', { name: 'Undo Mona Fathy payment' }).click();
  const undo = page.getByRole('dialog', { name: /Undo Mona Fathy/ });
  await expect(undo.getByRole('button', { name: 'Undo payment' })).toBeDisabled();
  await undo.getByLabel('Why?').fill('Recorded the wrong month');
  await undo.getByRole('button', { name: 'Undo payment' }).click();
  await expect(mona.getByRole('button', { name: 'Mark Mona Fathy paid' })).toBeVisible();
});
