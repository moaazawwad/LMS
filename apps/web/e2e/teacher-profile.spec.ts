import { expect, test } from '@playwright/test';
import { accounts, menu, signIn, signOut } from './helpers';

/** A teacher's file: one tab per subject, nothing piled up. */
test('the admin reads Mona’s file tab by tab, writes a note and her payment details', async ({
  page,
}) => {
  await signIn(page, accounts.admin);
  await menu(page, 'Teachers').click();

  // Lessons are moved or cancelled from the student's side, not from a teacher row.
  await page.getByRole('button', { name: 'Actions for Mona Fathy' }).click();
  await expect(page.getByRole('menuitem', { name: 'Reschedule a lesson' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Cancel a lesson' })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'View profile' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Mona Fathy' })).toBeVisible();
  const glance = page.getByRole('region', { name: 'At a glance' });
  await expect(glance).toContainText('Active students');
  await expect(page.getByRole('tab', { name: /Overview/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('tabpanel')).toContainText('Foundations 1');

  // Students: who they are.
  await page.getByRole('tab', { name: /Students/ }).click();
  await expect(page).toHaveURL(/tab=students/);
  const students = page.getByRole('table', { name: 'Students' });
  await expect(students).toContainText('Aisha Karim');
  await expect(students).toContainText('Youssef Nabil');

  // Attendance: month by month, and what went wrong.
  await page.getByRole('tab', { name: 'Attendance' }).click();
  await expect(page.getByRole('table', { name: 'Attendance by month' })).toBeVisible();
  await expect(page.getByRole('tabpanel')).toContainText('Absences and cancellations');

  // Personal details.
  await page.getByRole('tab', { name: 'Personal details' }).click();
  await expect(page.getByRole('tabpanel')).toContainText('Alexandria');
  await expect(page.getByRole('tabpanel')).toContainText('Arabic, English, French');

  // Pay & bank: numbers hidden until asked for.
  await page.getByRole('tab', { name: 'Pay & bank' }).click();
  const bank = page.getByRole('region', { name: 'Payment details' });
  await expect(bank).toContainText('InstaPay');
  await bank.getByRole('button', { name: 'Edit' }).click();
  await bank.getByLabel('Paid by').selectOption('BANK');
  await bank.getByLabel('Bank').fill('NBE');
  await bank.getByLabel('Account number').fill('2233445566');
  await bank.getByRole('button', { name: 'Save details' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Payment details saved.' }),
  ).toBeVisible();
  await expect(bank).toContainText('•••• 5566');
  await expect(bank).not.toContainText('2233445566');
  await bank.getByRole('button', { name: 'Show numbers' }).click();
  await expect(bank).toContainText('2233445566');

  // Notes.
  await page.getByRole('tab', { name: /Notes/ }).click();
  await page.getByLabel('New note').fill('Asked for fewer evening lessons from next month.');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Note added.' })).toBeVisible();
  await expect(page.getByRole('tabpanel').locator('article').first()).toContainText(
    'Asked for fewer evening lessons',
  );

  // Activity: the change is there, the account number is not.
  await page.getByRole('tab', { name: 'Activity' }).click();
  const log = page.getByRole('region', { name: 'Activity', exact: true });
  await expect(log).toContainText('Payment details changed');
  await expect(log).not.toContainText('2233445566');
});

test('staff see the file but not the Pay & bank tab', async ({ page }) => {
  await signIn(page, accounts.staff);
  await menu(page, 'Teachers').click();
  await page.getByRole('link', { name: 'Khaled Samir' }).first().click();
  await expect(page.getByRole('tab', { name: /Students/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Pay & bank' })).toHaveCount(0);
  await signOut(page);
});
