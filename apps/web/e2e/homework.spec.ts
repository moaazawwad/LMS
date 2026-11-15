import { expect, test } from '@playwright/test';
import { accounts, menu, signIn, signOut } from './helpers';

test('Omar sends his homework, Ahmed replies, Omar reads the reply', async ({ page }) => {
  await signIn(page, accounts.omar);
  await menu(page, 'Lessons & homework').click();
  await page.getByRole('link', { name: 'Send your answer' }).first().click();
  await expect(page).toHaveURL(/\/student\/lessons\/[0-9a-f-]+$/);
  const lessonUrl = page.url();
  await page.getByLabel('Send your answer').fill('I learned the 12 words and recorded them twice.');
  // A photo of the page goes with it.
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'words.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByRole('button', { name: 'Download words.png' })).toBeVisible();
  await page.getByRole('button', { name: 'Send to my teacher' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'You can change it until Ahmed Hassan replies' }),
  ).toBeVisible();
  await signOut(page);

  await signIn(page, accounts.ahmed);
  const waiting = page.getByRole('region', { name: 'Homework to check' });
  await expect(waiting.getByRole('link', { name: /Read and reply/ })).toHaveCount(2);
  await page.goto(lessonUrl.replace('/student/', '/teacher/'));
  await expect(page.getByText('I learned the 12 words and recorded them twice.')).toBeVisible();
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download words.png' }).click(),
  ]);
  expect(file.suggestedFilename()).toBe('words.png');
  await expect(page.getByRole('button', { name: 'Remove words.png' })).toHaveCount(0);
  await page.getByLabel('Reply to the student').fill('Great work. Bring the recording next time.');
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Sent to the student' })).toBeVisible();
  await menu(page, 'Today').click();
  await expect(waiting.getByRole('link', { name: /Read and reply/ })).toHaveCount(1);
  await signOut(page);

  await signIn(page, accounts.omar);
  await page.goto(lessonUrl);
  await expect(page.getByRole('note', { name: "Your teacher's reply" })).toContainText(
    'Great work. Bring the recording next time.',
  );
  await expect(page.getByRole('button', { name: /Send/ })).toHaveCount(0);
  // Checked: the file stays, but can't be removed any more.
  await expect(page.getByRole('button', { name: 'Download words.png' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove words.png' })).toHaveCount(0);
});
