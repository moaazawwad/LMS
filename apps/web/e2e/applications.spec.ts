import { expect, test } from '@playwright/test';
import { accounts, menu, signIn } from './helpers';

test('a website application becomes a student', async ({ page }) => {
  await signIn(page, accounts.admin);
  await menu(page, 'Requests').click();
  await page.getByRole('tab', { name: /Website applications/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Website applications' })).toBeVisible();

  const hana = page.getByRole('article', { name: 'Hana Rahman' });
  await expect(hana).toContainText('Quran reading for kids');
  await expect(hana).toContainText('Saturday and Sunday mornings');
  await expect(hana.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute(
    'href',
    'https://wa.me/447700900456',
  );

  await hana.getByLabel(/^Notes/).fill('Called, booking a trial');
  await hana.getByLabel(/^Notes/).blur();

  await hana.getByRole('button', { name: 'Add as student' }).click();
  const add = page.getByRole('dialog', { name: 'Add student' });
  await expect(add.getByLabel('Full name')).toHaveValue('Hana Rahman');
  await expect(add.getByLabel('Email')).toHaveValue('hana.rahman@example.com');
  await expect(add.getByLabel('Country')).toHaveValue('GB');
  await expect(add.getByLabel('Time zone')).toHaveValue('Europe/London');
  await add.getByLabel('Address').fill('5 Park Lane, London');
  await add.getByRole('button', { name: 'Add student' }).click();
  const done = page.getByRole('dialog', { name: 'Hana Rahman was added' });
  await expect(done).toBeVisible();
  await done.getByRole('button', { name: 'Close' }).click();

  await expect(page.getByRole('status').filter({ hasText: 'Hana Rahman: Student.' })).toBeVisible();
  await page.getByRole('button', { name: 'Students', exact: true }).click();
  const converted = page.getByRole('article', { name: 'Hana Rahman' });
  await expect(converted.getByRole('link', { name: 'Open student' })).toBeVisible();
  await expect(converted.getByLabel(/^Notes/)).toHaveValue('Called, booking a trial');
});
