import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests for the three dashboards.
 *
 * They start the real API (which also serves the built web app) on a throwaway
 * database that is wiped and re-seeded before every run. Build both apps first:
 *   npm run build            (from the repo root)
 *   npm --prefix apps/web run e2e
 *
 * UI_TEST_DATABASE_URL must point at a database whose name ends in _test.
 */
const PORT = Number(process.env.UI_TEST_PORT ?? 3100);
const DATABASE_URL = process.env.UI_TEST_DATABASE_URL ?? 'postgresql://lms:lms@localhost:5432/lms_ui_test';

export default defineConfig({
  testDir: './e2e',
  // One database for the whole run, so tests go one at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],
  outputDir: 'e2e-results',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // The app must not depend on the computer's own time zone.
    timezoneId: 'Europe/London',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Optional: use an already installed Chromium instead of `npx playwright install chromium`.
        launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
      },
    },
  ],
  webServer: {
    command: 'node dist/db/reset-test-db.js && node dist/main.js',
    cwd: '../api',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    env: {
      DATABASE_URL,
      JWT_SECRET: 'ui-tests-only',
      PORT: String(PORT),
      WEB_DIST: '../web/dist/web/browser',
    },
  },
});
