import { defineConfig, devices } from '@playwright/test';

/**
 * QA-suite Playwright project — one spec file at a time, against the shared app.
 *
 *   bunx playwright test qa/tests/PUB/PUB-06.spec.ts \
 *     --config=qa/playwright.qa.config.ts --workers=1 --repeat-each=1
 *
 * There is deliberately no `webServer`: the app (`http://localhost:3010`) and
 * Supabase (`http://localhost:54421`) are shared infrastructure that this suite
 * never starts or stops. See `qa/QA-SUITE-APPROACH.md`.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.QA_BASE_URL ?? 'http://localhost:3010',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'qa-chromium', use: { ...devices['Desktop Chrome'] } }],
});
