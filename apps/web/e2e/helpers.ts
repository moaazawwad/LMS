import { expect, type Page } from '@playwright/test';

/** Every demo account from the seed uses this password. */
export const DEMO_PASSWORD = 'ChangeMe123!';

export const accounts = {
  admin: 'admin@academy.local',
  staff: 'staff@academy.local',
  ahmed: 'ahmed@academy.local', // teacher, Standard level
  omar: 'omar@academy.local', // student, New York, Standard 2/week with Ahmed; one finished cycle of history
  mariam: 'mariam@academy.local', // student, New York, Basic 1/week with Khaled
  aisha: 'aisha@academy.local', // student, Sydney, Premium 3/week with Mona
  mona: 'mona@academy.local', // teacher, Premium level
  youssef: 'youssef@academy.local', // student, London, Premium 2/week with Mona; a finished cycle with every attendance case
} as const;

export async function signIn(page: Page, email: string, password = DEMO_PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** A link in the side menu (pages can have links with the same words). */
export function menu(page: Page, name: string) {
  return page.locator('aside nav').getByRole('link', { name, exact: true });
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
}

/** A short suffix so names and emails differ between runs. */
export function unique() {
  return Date.now().toString(36).slice(-5);
}

/** Accept the browser's confirm() boxes the app uses before destructive actions. */
export function acceptConfirms(page: Page) {
  page.on('dialog', (d) => void d.accept());
}

/**
 * Omar's finished cycle is the 28 days before today, so its lessons are in this
 * month, the previous one, or both. Stay here if any show, else go back a month.
 */
export async function showMonthWithDoneLessons(page: Page) {
  // This month always has upcoming lessons, so wait for those first.
  await expect(
    page.getByRole('link', { name: /coming up|nobody entered|done/ }).first(),
  ).toBeVisible();
  if ((await page.getByRole('link', { name: /, done$/ }).count()) === 0) {
    await page.getByRole('button', { name: 'Previous month' }).click();
  }
  await expect(page.getByRole('link', { name: /, done$/ }).first()).toBeVisible();
}
