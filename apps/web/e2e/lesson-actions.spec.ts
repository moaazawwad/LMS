import { expect, type Page, test } from '@playwright/test';
import { accounts, menu, signIn, unique } from './helpers';

/**
 * Add a lesson, transfer and reschedule, each on its own, for a new student
 * (so the demo students other tests read stay as they are).
 */
test.describe.configure({ mode: 'serial' });

const id = unique();
const student = { name: `Lina Hassan ${id}`, email: `lina.${id}@academy.local` };

async function openStudent(page: Page) {
  await signIn(page, accounts.admin);
  await menu(page, 'Students').click();
  await page.getByLabel('Search').fill(student.name);
  await page.getByRole('link', { name: student.name }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: student.name })).toBeVisible();
}

test('a new student gets weekly lessons from "Add a lesson"', async ({ page }) => {
  await signIn(page, accounts.admin);
  await menu(page, 'Students').click();
  await page.getByRole('button', { name: 'Add student' }).click();
  const add = page.getByRole('dialog', { name: 'Add student' });
  await add.getByLabel('Full name').fill(student.name);
  await add.getByLabel('Email').fill(student.email);
  await add.getByLabel('Country').selectOption('US');
  await add.getByLabel('Address').fill('5 Elm St, Boston');
  await add.getByRole('button', { name: 'Add student' }).click();
  await page
    .getByRole('dialog', { name: `${student.name} was added` })
    .getByRole('button', { name: 'Book weekly lessons' })
    .click();

  await page.getByLabel('Curriculum', { exact: true }).selectOption({ label: 'Foundations 1' });
  await page.getByLabel('Teacher', { exact: true }).selectOption({ index: 1 });
  const free = page.getByRole('region', { name: 'Free every week with this teacher' });
  await free.getByRole('button').first().click();
  await page.getByRole('button', { name: 'Add weekly lessons' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Weekly lessons added' })).toBeVisible();
});

test('one lesson with another teacher, and nothing about transfers on the way', async ({
  page,
}) => {
  await openStudent(page);
  await page.getByRole('link', { name: 'Add a lesson' }).click();
  await page.getByRole('radio', { name: /One lesson/ }).click();
  await page.getByRole('radio', { name: /Another teacher/ }).click();
  // Only adding here: moving lessons has its own action.
  await expect(page.getByText(/Move to another teacher|Change weekly times/)).toHaveCount(0);

  await page.getByLabel('Teacher', { exact: true }).selectOption({ index: 1 });
  const teacher = (await page
    .getByLabel('Teacher', { exact: true })
    .locator('option:checked')
    .textContent())!
    .split(' · ')[0]
    .trim();
  await page
    .getByRole('group', { name: 'Free times that day' })
    .getByRole('button')
    .first()
    .click();
  await page.getByRole('button', { name: 'Add lesson' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Lesson added/ })).toBeVisible();

  // The student's page shows it in its activity, without anyone writing a note.
  await expect(page.getByRole('region', { name: 'Activity', exact: true })).toContainText(
    `with ${teacher}`,
  );
});

test('transfer: only some lessons, picked from a teacher search', async ({ page }) => {
  await signIn(page, accounts.admin);
  await menu(page, 'Students').click();
  await page.getByLabel('Search').fill(student.name);
  await page.getByRole('button', { name: `Actions for ${student.name}` }).click();
  await page.getByRole('menuitem', { name: 'Transfer', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Transfer' })).toBeVisible();
  await page.getByRole('radio', { name: /For some lessons/ }).click();
  const lessons = page.getByRole('group', { name: /Lessons to transfer/ });
  // The lesson with the stand-in from before says so; pick one with their own teacher.
  await expect(lessons.locator('label', { hasText: ' · with ' })).toHaveCount(1);
  await lessons.locator('label', { hasNotText: ' · with ' }).first().getByRole('checkbox').check();

  const search = page.getByRole('combobox', { name: 'Find a teacher' });
  await expect(search).toBeVisible();
  const first = page.getByRole('listbox', { name: 'Teachers' }).getByRole('option').first();
  const name = (await first.locator('strong').textContent())!.trim();
  await search.fill(name.slice(0, 4));
  await page.getByRole('option', { name: new RegExp(name) }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Transfer 1 lesson' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: `1 lesson transferred to ${name}.` }),
  ).toBeVisible();
});

test('reschedule from the dialog: who asked, a free time, and no note', async ({ page }) => {
  await openStudent(page);
  await page.getByRole('button', { name: 'Change', exact: true }).first().click();
  const dlg = page.getByRole('dialog', { name: 'Reschedule a lesson' });
  await expect(dlg.getByRole('radio', { name: 'Student' })).toHaveAttribute('aria-checked', 'true');
  await expect(dlg.getByText("Counts toward the student's reschedules")).toBeVisible();
  await expect(dlg.getByRole('textbox', { name: /Note/ })).toHaveCount(0);
  await dlg.getByRole('radio', { name: 'Academy' }).click();
  const time = dlg.locator('.slots button').first();
  await time.click();
  await expect(dlg.getByText(/^To /)).toBeVisible();
  await dlg.getByRole('button', { name: 'Move lesson' }).click();
  await expect(dlg).toBeHidden();
});
