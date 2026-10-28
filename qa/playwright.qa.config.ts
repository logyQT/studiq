import { defineConfig, devices } from '@playwright/test';

/**
 * QA-suite Playwright config.
 *
 * The suite runs one spec at a time against the shared app on :3010; it never
 * starts a web server and never runs the product e2e suite (`__tests__/e2e`),
 * whose `globalSetup` seeds a different tenant graph.
 *
 *   bunx playwright test qa/tests/PUB/PUB-02.spec.ts \
 *     --config qa/playwright.qa.config.ts --workers=1 --repeat-each=1
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: 'list',
  timeout: 60_000,
  use: {
    baseURL: process.env.QA_BASE_URL ?? 'http://localhost:3010',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
