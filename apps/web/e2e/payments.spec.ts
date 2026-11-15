import { expect, test } from '@playwright/test';
import { accounts, menu, signIn, signOut } from './helpers';

/**
 * Mariam's first invoice is due from day one (prepaid). The test ends by
 * taking the payment back, so the invoice is due again for the other files.
 */
test('a payment is recorded with how it came in; the student is told; an admin can take it back', async ({
  page,
}) => {
  // The student sees what is due and how many lessons she can still take.
  await signIn(page, accounts.mariam);
  const due = page.getByTestId('due-notice');
  await expect(due).toContainText('is not paid yet');
  await expect(due).toContainText('You can take 2 more lessons before paying');
  await due.getByRole('link', { name: 'See how to pay' }).click();
  await expect(page.getByTestId('standing')).toContainText('This invoice was due on');
  await signOut(page);

  await signIn(page, accounts.admin);
  await menu(page, 'Invoices').click();
  const rows = page.getByRole('table', { name: 'Invoices' }).locator('tbody tr');
  await page.getByLabel('Search').fill('mariam');
  await page.getByLabel('Status').selectOption('OPEN');
  await expect(page.getByRole('status').filter({ hasText: 'match' })).toHaveText('1 invoice match');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Mariam Ali');
  const number = (await rows.first().getByRole('link').first().innerText()).trim();
  await expect(rows.first()).toContainText('Overdue');

  await rows
    .first()
    .getByRole('button', { name: `Mark ${number} paid` })
    .click();
  const dialog = page.getByRole('dialog', { name: `Record payment for ${number}` });
  // How it was paid is needed.
  await expect(dialog.getByRole('button', { name: 'Record payment' })).toBeDisabled();
  await dialog.getByLabel('How was it paid?').selectOption('INSTAPAY');
  await dialog.getByLabel(/Reference/).fill('IP-778899');
  await dialog.getByLabel(/Note/).fill('Sent by her father');
  await dialog.getByRole('button', { name: 'Record payment' }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole('status').filter({ hasText: 'Invoice marked as paid.' }),
  ).toBeVisible();

  await page.getByLabel('Status').selectOption('PAID');
  const paid = rows.filter({ hasText: number });
  await expect(paid).toContainText('InstaPay');
  await paid.getByRole('link', { name: number }).click();
  await expect(page.getByRole('article')).toContainText('Paid by');
  await expect(page.getByRole('article')).toContainText('InstaPay');
  await expect(page.getByRole('article')).toContainText('IP-778899');
  await expect(page.getByText('Payment recorded by')).toContainText('Sent by her father');
  await signOut(page);

  // Mariam: nothing due any more, and the bell says the payment arrived.
  await signIn(page, accounts.mariam);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Hi Mariam');
  await expect(page.getByTestId('due-notice')).toHaveCount(0);
  await page.getByRole('button', { name: /Notifications, \d+ unread/ }).click();
  const notice = page
    .getByRole('region', { name: 'Notifications' })
    .getByRole('button', { name: /Payment received/ })
    .first();
  await expect(notice).toContainText(number);
  await notice.click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Invoice ${number}`);
  // The staff note stays with the staff.
  await expect(page.getByText('Sent by her father')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Take the payment back' })).toHaveCount(0);
  await signOut(page);

  // Recorded by mistake: an admin takes it back, with a reason.
  await signIn(page, accounts.admin);
  await menu(page, 'Invoices').click();
  await page.getByLabel('Search').fill('mariam');
  await rows.filter({ hasText: number }).getByRole('link', { name: number }).click();
  await page.getByRole('button', { name: 'Take the payment back' }).click();
  const back = page.getByRole('dialog', { name: `Take back the payment of ${number}` });
  await expect(back.getByRole('button', { name: 'Take payment back' })).toBeDisabled();
  await back.getByLabel(/Why\?/).fill('Recorded on the wrong invoice');
  await back.getByRole('button', { name: 'Take payment back' }).click();
  await expect(back).toBeHidden();
  await expect(page.getByRole('button', { name: 'Mark paid' })).toBeVisible();
  await expect(page.getByTestId('standing')).toBeVisible();
});

test('staff cannot take a payment back', async ({ page }) => {
  await signIn(page, accounts.staff);
  await menu(page, 'Invoices').click();
  await page.getByLabel('Status').selectOption('PAID');
  await page
    .getByRole('table', { name: 'Invoices' })
    .locator('tbody tr')
    .first()
    .getByRole('link')
    .first()
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Invoice');
  await expect(page.getByRole('button', { name: 'Take the payment back' })).toHaveCount(0);
});
