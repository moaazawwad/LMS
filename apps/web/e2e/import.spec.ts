import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { accounts, menu, signIn, signOut } from './helpers';

const csv = (text: string) => ({
  name: 'students.csv',
  mimeType: 'text/csv',
  buffer: Buffer.from(text, 'utf8'),
});

test('admin imports students from a sheet: problems first, then the accounts', async ({ page }) => {
  await signIn(page, accounts.admin);
  await menu(page, 'Students').click();
  await page.getByRole('link', { name: 'Import from Excel' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Import students');

  // Arabic and English column names; one row with problems.
  await page
    .getByLabel('Excel (.xlsx) or CSV file')
    .setInputFiles(
      csv(
        'الاسم,Email,City,Notes\nNour Hassan,nour.import@example.com,Toronto,new\nX,not-an-email,Mars,\n',
      ),
    );
  await expect(page.getByText('Columns found:')).toContainText('Name, Email, Time zone');
  await expect(page.getByText('not used: Notes')).toBeVisible();
  const rows = page.getByRole('table', { name: 'Rows in the file' }).locator('tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText('"not-an-email" is not an email address.');
  await expect(rows.nth(1)).toContainText('Unknown time zone "Mars"');
  await expect(page.getByRole('button', { name: /Create/ })).toBeDisabled();

  // Fixed file: everything ready.
  await page
    .getByLabel('Excel (.xlsx) or CSV file')
    .setInputFiles(
      csv(
        'Name,Email,Time zone\nNour Hassan,nour.import@example.com,Toronto\nAdam Lee,adam.import@example.com,Australia/Sydney\n',
      ),
    );
  await expect(page.getByRole('status').filter({ hasText: 'ready' })).toHaveText('2 ready');
  await page.getByRole('button', { name: 'Create 2 accounts' }).click();
  await expect(page.getByRole('heading', { name: '2 accounts created' })).toBeVisible();
  const created = page.getByRole('table', { name: 'New accounts' }).locator('tbody tr');
  const password = (await created.first().locator('td').nth(2).innerText()).trim();
  expect(password).toMatch(/^[A-Za-z2-9]{12}$/);

  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download passwords (CSV)' }).click(),
  ]);
  expect(file.suggestedFilename()).toBe('new-students-passwords.csv');
  expect(await readFile((await file.path())!, 'utf8')).toContain(
    `Nour Hassan,nour.import@example.com,${password}`,
  );

  // The new student can sign in with it.
  await signOut(page);
  await signIn(page, 'nour.import@example.com', password);
  await expect(page).toHaveURL(/\/student\//);
});

test('staff do not see the import', async ({ page }) => {
  await signIn(page, accounts.staff);
  await menu(page, 'Students').click();
  await expect(page.getByRole('button', { name: 'Add student' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Import from Excel' })).toHaveCount(0);
});
