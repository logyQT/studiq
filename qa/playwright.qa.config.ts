import { defineConfig, devices } from '@playwright/test';

/**
 * QA-suite runner (`qa/tests`).
 *
 * The suite runs against the **shared, already-provisioned app** — it never
 * builds or starts one. Defaults to the shared slot (`http://localhost:3010`);
 * set `QA_APP_URL` to point it elsewhere. Each spec seeds its own tenant (see
 * `qa/cases/*` and `scripts/qa-tenant.ts`), so no global seeding step is needed.
 *
 * Single worker on purpose: the shared box also runs the app, Supabase and the
 * browser tiles, and parallel browsers have OOM-killed it.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  use: {
    baseURL: process.env.QA_APP_URL ?? 'http://localhost:3010',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
