import { defineConfig, devices } from '@playwright/test';

/**
 * QA-suite runner.
 *
 * One shared app + one shared Supabase back every QA-suite case; isolation comes
 * from each case's tenant (and, for public pages, from a clean browser context).
 * This config only knows about `qa/tests` so it can be run next to the product
 * e2e suite without its globalSetup/tenant seeding.
 *
 *   bunx playwright test --config=qa/playwright.qa.config.ts qa/tests/PUB/PUB-01.spec.ts
 *
 * `QA_APP_URL` overrides the shared app URL (defaults to the QA-suite app).
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  // Never hide a flake behind a retry: the suite requires 3/3 independent greens.
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: {
    baseURL: process.env.QA_APP_URL ?? 'http://localhost:3010',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
