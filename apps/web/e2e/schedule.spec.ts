import { expect, test } from '@playwright/test';
import { accounts, menu, signIn } from './helpers';

/**
 * Lessons that no longer fit: the teacher's hours change after lessons are
 * booked (a clock change does the same). The admin is told when saving the
 * hours, sees a count on Today, and finds the lessons on the Schedule check page.
 */
test('narrowing Khaled’s hours flags Mariam’s booked lessons in the schedule check', async ({
  page,
}) => {
  await signIn(page, accounts.admin);
  await menu(page, 'Teachers').click();
  await page
    .getByRole('region', { name: 'Teacher list' })
    .getByRole('link', { name: 'Khaled Samir' })
    .click();
  await page.getByRole('link', { name: 'Weekly hours' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Weekly hours' })).toBeVisible();

  // Mariam has Tuesdays at 1:00 PM New York: 7 or 8 PM Cairo. End Khaled's Tuesday at 5 PM.
  await page.getByLabel('Tue until').fill('17:00');
  await page.getByRole('button', { name: 'Save hours' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Weekly hours saved.' })).toBeVisible();
  const saved = page.getByTestId('outside-hours');
  await expect(saved).toContainText(/booked lessons? (is|are) now outside these hours/);

  await saved.getByRole('link', { name: 'See them in the schedule check' }).click();
  const panel = page.locator('#schedule');
  await expect(panel.getByRole('heading', { name: 'Schedule check' })).toBeVisible();
  const rows = panel
    .getByRole('list', { name: 'Lessons to fix' })
    .getByRole('listitem')
    .filter({ hasText: 'Mariam Ali' });
  await expect(rows.first()).toContainText("Outside Khaled Samir's hours");

  // Change opens the usual move / cancel dialog for that lesson.
  await rows
    .first()
    .getByRole('button', { name: /^Change Mariam Ali/ })
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();

  // Today only says how many need attention, with a link here.
  await menu(page, 'Today').click();
  await expect(page.getByRole('status').filter({ hasText: /needs? attention/ })).toBeVisible();
  await expect(page.locator('#schedule')).toHaveCount(0);
});
