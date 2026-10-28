import { defineConfig, devices } from '@playwright/test';

/**
 * QA-suite runner: one shared app + one shared Supabase, one spec per case.
 *
 *   bunx playwright test -c qa/playwright.qa.config.ts qa/tests/<AREA>/<CASEID>.spec.ts --workers=1
 *
 * Never raise `workers`: the shared VM also hosts the app, Supabase and the eight
 * browser tiles, and a parallel run OOM-kills it.
 */
export default defineConfig({
  testDir: './qa/tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  use: {
    baseURL: process.env.QA_APP_URL ?? 'http://localhost:3010',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
