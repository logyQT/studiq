import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the QA suite (`qa/tests/**`).
 *
 * The QA suite runs against the **shared** QA app (see `qa/QA-SUITE-APPROACH.md`),
 * which is operator-managed: this config starts no `webServer` and no
 * `globalSetup` seeder, so a spec can never build, boot or reset the shared app.
 * Each case seeds/uses its own tenant instead.
 *
 * Run exactly one spec at a time:
 *
 *   bunx playwright test qa/tests/PUB/PUB-07.spec.ts \
 *     --config=qa/playwright.qa.config.ts --workers=1 --repeat-each=1
 *
 * `QA_APP_URL` points the run at another shared app (default `http://localhost:3010`).
 */
export default defineConfig({
  testDir: './tests',
  // Keep artifacts out of `qa/`; the repo root already ignores `test-results/`.
  outputDir: '../test-results/qa',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.QA_APP_URL ?? 'http://localhost:3010',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
