import { expect, test } from '@playwright/test';
import { accounts, menu, signIn, signOut } from './helpers';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

test('the academy adds a PDF book to a curriculum and its student reads it', async ({ page }) => {
  await signIn(page, accounts.admin);
  await menu(page, 'Curricula & plans').click();
  const row = page.locator('.list-row', { hasText: 'Foundations 1' });
  await row.getByRole('button', { name: 'Books' }).click();
  await page.getByLabel('Book title').fill('Foundations 1 student book');
  await page.getByLabel('Upload a PDF to Foundations 1').setInputFiles({
    name: 'foundations-1.pdf',
    mimeType: 'application/pdf',
    buffer: PDF,
  });
  const list = page.getByRole('list', { name: 'Foundations 1 books' });
  await expect(list).toContainText('Foundations 1 student book');
  await expect(list).toContainText('foundations-1.pdf');
  await signOut(page);

  // Youssef studies Foundations 1.
  await signIn(page, accounts.youssef);
  await menu(page, 'Books').click();
  const books = page.getByRole('list', { name: 'Foundations 1 books' });
  await expect(books).toContainText('Foundations 1 student book');
  await expect(books.getByRole('button', { name: /^Remove/ })).toHaveCount(0);
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    books.getByRole('button', { name: 'Download Foundations 1 student book' }).click(),
  ]);
  expect(file.suggestedFilename()).toBe('foundations-1.pdf');
});
