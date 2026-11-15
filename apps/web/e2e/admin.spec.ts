import { expect, test, type Page } from '@playwright/test';
import { acceptConfirms, accounts, DEMO_PASSWORD, menu, signIn, signOut, unique } from './helpers';

/**
 * The admin journey for a new family: a teacher joins, gets weekly hours,
 * a student is added and booked with them. Steps build on each other.
 */
test.describe.configure({ mode: 'serial' });

const id = unique();
const teacher = { name: `Sara Adel ${id}`, email: `sara.${id}@academy.local` };
const student = { name: `Noah Ibrahim ${id}`, email: `noah.${id}@academy.local` };

/** Pick the option whose text contains `text` (labels carry prices and levels). */
async function choose(page: Page, label: string, text: string) {
  const select = page.getByLabel(label, { exact: true });
  const value = await select.locator('option', { hasText: text }).first().getAttribute('value');
  await select.selectOption(value ?? '');
}

async function asAdmin(page: Page) {
  await signIn(page, accounts.admin);
  await expect(page).toHaveURL(/\/admin\/today$/);
}

test('adds a curriculum and changes a plan price', async ({ page }) => {
  await asAdmin(page);
  await menu(page, 'Curricula & plans').click();

  await page.getByPlaceholder(/New curriculum/).fill(`Conversation ${id}`);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText(`Conversation ${id}`)).toBeVisible();

  // The level column is plain text, so it tells the plan rows apart.
  const standard = page
    .getByRole('row')
    .filter({ hasText: 'Standard' })
    .filter({ has: page.getByRole('button', { name: 'Save' }) });
  await standard.getByLabel('Price').fill('16');
  await standard.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Standard saved' })).toBeVisible();
});

test('adds a teacher, then their weekly hours', async ({ page }) => {
  await asAdmin(page);
  await menu(page, 'Teachers').click();
  await page.getByRole('link', { name: 'Add teacher' }).click();

  await page.getByLabel('Full name').fill(teacher.name);
  await page.getByLabel('Email').fill(teacher.email);
  await page.getByLabel('Level').selectOption('STANDARD');
  await page.getByLabel('Meeting link (Zoom or Google Meet)').fill('https://zoom.us/j/5550001111');
  await page.getByRole('checkbox', { name: 'Foundations 1' }).check();
  await page.getByRole('button', { name: 'Add teacher' }).click();

  // The temporary password is still on screen after the form is gone.
  await expect(page).toHaveURL(/\/availability\?created=1$/);
  await expect(
    page.getByRole('status').filter({ hasText: 'with the temporary password' }),
  ).toContainText(`${teacher.email} with the temporary password`);

  await page.getByRole('button', { name: 'Add hours on Sat' }).click();
  await page.getByLabel('Sat from').fill('14:00');
  await page.getByLabel('Sat until').fill('22:00');
  await page.getByRole('button', { name: 'Copy Saturday to every day' }).click();
  await expect(page.getByLabel('Fri until')).toHaveValue('22:00');
  await page.getByRole('button', { name: 'Save hours' }).click();

  await expect(page.getByRole('heading', { level: 1, name: teacher.name })).toBeVisible();
});

test('adds a student and books them, and the teacher-hours rule holds', async ({ page }) => {
  await asAdmin(page);
  await menu(page, 'Students').click();
  await page.getByRole('button', { name: 'Add student' }).click();

  // A pop-up: details only; lessons can wait.
  const add = page.getByRole('dialog', { name: 'Add student' });
  await add.getByLabel('Full name').fill(student.name);
  await add.getByLabel('Email').fill(student.email);
  await add.getByLabel('Phone / WhatsApp').fill('+1 555 010 2030');
  await add.getByLabel('Country').selectOption('US');
  // The country suggests its time zone.
  await expect(add.getByLabel('Time zone')).toHaveValue('America/New_York');
  await add.getByLabel('Address').fill('12 Main St, Springfield');
  await add.getByRole('button', { name: 'Add student' }).click();

  const done = page.getByRole('dialog', { name: `${student.name} was added` });
  await expect(done.getByRole('status')).toContainText(student.email);
  await done.getByRole('button', { name: 'Book weekly lessons' }).click();
  await expect(page).toHaveURL(/\/add-lesson\?kind=weekly$/);
  // "Add a lesson" opens on weekly lessons: no weekly lessons yet, so no teacher step.
  await expect(page.getByRole('radio', { name: /Every week/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByRole('radio', { name: /One lesson/ })).toBeDisabled();

  await choose(page, 'Curriculum', 'Foundations 1');
  // The plan follows the weekly times: 1 hour-long lesson a week is Basic, 2 is Standard.
  const plan = page.getByTestId('auto-plan');
  await expect(plan).toContainText('Basic');
  await page.getByRole('button', { name: '+ Add a day' }).click();
  await expect(plan).toContainText('Standard');
  await expect(
    page.getByText('2 lessons of 60 min a week · 8 hours per 28-day cycle'),
  ).toBeVisible();
  await choose(page, 'Teacher', teacher.name);

  // 8 PM in New York is 2-3 AM in Cairo: outside the teacher's hours.
  await page.getByLabel('Time 1').fill('20:00');
  await page.getByLabel('Time 2').fill('20:00');
  await page.getByRole('button', { name: 'Add weekly lessons' }).click();
  // The message says the teacher's hours that day.
  await expect(page.getByRole('alert')).toContainText(
    'The teacher is not available at that time; their hours are Wed 2:00 PM–10:00 PM Cairo (4 lessons:',
  );
  // Admins may go ahead anyway, without writing anything: the log names the rule.
  await expect(page.getByRole('button', { name: 'Add anyway' })).toBeEnabled();

  // Or pick from the teacher's free weekly times: 10 AM in New York is 4-5 PM in Cairo all year round.
  const free = page.getByRole('region', { name: 'Free every week with this teacher' });
  await expect(
    free.getByRole('group', { name: 'Tue' }).getByRole('button', { name: '9:00 PM' }),
  ).toHaveCount(0);
  await free.getByRole('group', { name: 'Tue' }).getByRole('button', { name: '10:00 AM' }).click();
  await free.getByRole('group', { name: 'Thu' }).getByRole('button', { name: '10:00 AM' }).click();
  await expect(page.getByLabel('Time 1')).toHaveValue('10:00');
  await expect(page.getByLabel('Day 2')).toHaveValue('4');
  await page.getByRole('button', { name: 'Add weekly lessons' }).click();

  await expect(page.getByRole('heading', { level: 1, name: student.name })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Manage subscription' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change' })).toHaveCount(8);

  // Adding a day later moves the plan up a step (shown before saving).
  await page.getByRole('link', { name: 'Manage subscription' }).click();
  await page.getByRole('button', { name: /Change weekly times/ }).click();
  const next = page.getByTestId('auto-plan');
  await expect(next).toContainText('Standard');
  await page.getByRole('button', { name: '+ Add a day' }).click();
  await expect(next).toContainText('Premium');
  await expect(next).toContainText('was Standard');
  await page
    .getByRole('button', { name: /^Remove \w{3} \d\d:\d\d$/ })
    .last()
    .click();
  await expect(next).not.toContainText('was Standard');
});

test('books a free trial lesson for the student', async ({ page }) => {
  await asAdmin(page);
  await menu(page, 'Students').click();
  await page.getByRole('link', { name: student.name }).first().click();
  // The contact card has what the family gave.
  const contact = page.getByRole('region', { name: 'Contact' });
  await expect(contact).toContainText('United States');
  await expect(contact).toContainText('12 Main St, Springfield');
  await expect(contact.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute(
    'href',
    'https://wa.me/15550102030',
  );

  // A trial is one kind of lesson under "Add a lesson".
  await page.getByRole('link', { name: 'Add a lesson' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Add a lesson' })).toBeVisible();
  await page.getByRole('radio', { name: /Free trial/ }).click();
  await choose(page, 'Curriculum', 'Foundations 1');
  await choose(page, 'Teacher', teacher.name);
  await page.getByLabel('Length').selectOption('30');
  const free = page.getByRole('group', { name: 'Free times that day' });
  await free.getByRole('button').first().click();
  await page.getByRole('button', { name: 'Book trial lesson' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Trial lesson booked' })).toBeVisible();
  await expect(page.getByText('Trial (free)').first()).toBeVisible();
});

test('pauses the subscription and the lessons become credits', async ({ page }) => {
  acceptConfirms(page);
  await asAdmin(page);
  await menu(page, 'Students').click();
  await page.getByRole('link', { name: student.name }).first().click();
  await page.getByRole('link', { name: 'Manage subscription' }).click();

  await page.getByRole('button', { name: /^Pause/ }).click();
  await page.getByRole('button', { name: 'Pause subscription' }).click();
  await expect(page.getByRole('heading', { name: 'This subscription is paused' })).toBeVisible();

  // The page's own activity says what happened by itself: nobody writes a note.
  await expect(page.getByRole('region', { name: 'Activity', exact: true })).toContainText(
    'Subscription paused',
  );
});

test('a staff member whose sign-in is turned off cannot sign in', async ({ page }) => {
  await asAdmin(page);
  await menu(page, 'Staff & roles').click();

  const name = `Youssef Kamal ${id}`;
  const email = `youssef.${id}@academy.local`;
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Email').fill(email);
  const password = await page.getByLabel('Temporary password').inputValue();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: `${name} added` })).toBeVisible();

  await page
    .getByRole('row')
    .filter({ hasText: email })
    .getByRole('button', { name: 'Turn off sign-in' })
    .click();
  await expect(
    page
      .getByRole('row')
      .filter({ hasText: email })
      .getByRole('button', { name: 'Turn on sign-in' }),
  ).toBeVisible();
  await signOut(page);

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("turning off a student's sign-in keeps them out until it is turned back on", async ({
  page,
}) => {
  acceptConfirms(page);
  const tryAisha = async () => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(accounts.aisha);
    await page.getByLabel('Password').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
  };

  await asAdmin(page);
  await menu(page, 'Students').click();
  await page.getByRole('table').getByRole('link', { name: 'Aisha Karim' }).click();
  await page.getByRole('button', { name: 'Turn off sign-in' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('sign-in off');
  await signOut(page);

  await tryAisha();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);

  await asAdmin(page);
  await menu(page, 'Students').click();
  await page.getByRole('table').getByRole('link', { name: 'Aisha Karim' }).click();
  await page.getByRole('button', { name: 'Turn on sign-in' }).click();
  await expect(page.getByRole('heading', { level: 1 })).not.toContainText('sign-in off');
  await signOut(page);

  await tryAisha();
  await expect(page).toHaveURL(/\/student\/home$/);
});
