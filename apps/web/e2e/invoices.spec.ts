import { expect, test } from '@playwright/test';
import { accounts, menu, signIn, signOut } from './helpers';

test('admin finds an invoice, voids it and issues a new one; the student sees it was replaced', async ({
  page,
}) => {
  await signIn(page, accounts.admin);
  await menu(page, 'Invoices').click();
  const rows = page.getByRole('table', { name: 'Invoices' }).locator('tbody tr');

  await page.getByLabel('Search').fill('aisha');
  await page.getByLabel('Status').selectOption('OPEN');
  await expect(page.getByRole('status').filter({ hasText: 'match' })).toHaveText('1 invoice match');
  await expect(rows).toHaveCount(1);
  const number = (await rows.first().getByRole('link').first().innerText()).trim();

  await rows.first().getByRole('link', { name: number }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Invoice ${number}`);
  await page.getByRole('button', { name: 'Void invoice' }).click();
  const dialog = page.getByRole('dialog', { name: `Void ${number}` });
  // A reason is needed.
  await expect(dialog.getByRole('button', { name: 'Void and issue a new one' })).toBeDisabled();
  await dialog.getByLabel(/Why\?/).fill('Family switched to monthly bank transfer');
  await dialog.getByRole('button', { name: 'Void and issue a new one' }).click();
  await expect(dialog).toBeHidden();

  // The new invoice opens, pointing back to the void one.
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText(`Invoice ${number}`);
  const fresh = (await page.getByRole('heading', { level: 1 }).innerText()).match(/INV-\d+/)![0];
  await page.getByRole('link', { name: number }).click();
  const note = page.getByRole('note');
  await expect(note).toContainText('This invoice is void');
  await expect(note).toContainText('Reason: Family switched to monthly bank transfer');
  await expect(note.getByRole('link', { name: fresh })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Void invoice' })).toHaveCount(0);

  // The list can show only void invoices.
  await menu(page, 'Invoices').click();
  await page.getByLabel('Status').selectOption('VOID');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(number);
  await signOut(page);

  // Aisha sees it was replaced, without the academy's note.
  await signIn(page, accounts.aisha);
  await menu(page, 'Invoices').click();
  await page.getByRole('link', { name: number }).click();
  await expect(page.getByRole('note')).toContainText('This invoice is void');
  await expect(page.getByRole('note')).not.toContainText('bank transfer');
  await expect(page.getByRole('note').getByRole('link', { name: fresh })).toBeVisible();
});

test('staff can mark an invoice paid but not void it', async ({ page }) => {
  await signIn(page, accounts.staff);
  await menu(page, 'Invoices').click();
  await page.getByLabel('Status').selectOption('OPEN');
  const first = page.getByRole('table', { name: 'Invoices' }).locator('tbody tr').first();
  await first.getByRole('link').first().click();
  await expect(page.getByRole('button', { name: 'Mark paid' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Void invoice' })).toHaveCount(0);
});

test('admin writes how families pay; unpaid invoices show it', async ({ page }) => {
  await signIn(page, accounts.admin);
  await menu(page, 'Settings').click();
  await page
    .getByLabel('Payment instructions')
    .fill(
      'Bank transfer: CIB 1000 2000 3000\nWrite the invoice number as the reference.\nOr pay online: https://pay.example.com/brightverse\nThank you.',
    );
  await page
    .getByRole('region', { name: 'How families pay' })
    .getByRole('button', { name: 'Save' })
    .click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Unpaid invoices show it now' }),
  ).toBeVisible();

  await menu(page, 'Invoices').click();
  await page.getByLabel('Status').selectOption('OPEN');
  await page
    .getByRole('table', { name: 'Invoices' })
    .locator('tbody tr')
    .first()
    .getByRole('link')
    .first()
    .click();
  const how = page.getByRole('region', { name: 'How to pay' });
  await expect(how).toContainText('Bank transfer: CIB 1000 2000 3000');
  await expect(how).toContainText('Write the invoice number as the reference.');
  await expect(how).toContainText('Thank you.');
  await expect(
    how.getByRole('link', { name: 'https://pay.example.com/brightverse' }),
  ).toHaveAttribute('href', 'https://pay.example.com/brightverse');
});
