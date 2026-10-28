import { defineConfig, devices } from '@playwright/test';

/**
 * QA-suite runner: one shared app + one shared Supabase, one spec per case.
 *
 *   bunx playwright test -c qa/playwright.qa.config.ts qa/tests/<AREA>/<CASEID>.spec.ts --workers=1
 *
 * Local: keep `workers` at 1 — the dev box also hosts the app, Supabase and the
 * eight browser tiles, and a parallel run OOM-kills it. CI sets QA_WORKERS (each
 * test owns its tenant, so parallel is safe there).
 */
export default defineConfig({
  // `testDir` is resolved relative to this config file, not the repo root:
  // `./qa/tests` would point at `qa/qa/tests` and match zero specs.
  testDir: './tests',
  fullyParallel: false,
  workers: Number(process.env.QA_WORKERS ?? 1),
  // The CI runner is 4 vCPU and hosts Supabase, the Next app and four Chromium
  // workers at once. Playwright's 30s/5s defaults are tight enough that a slow
  // API round-trip or a filtered table render trips them while the product is
  // fine; local runs finish in single-digit seconds.
  timeout: 90_000,
  expect: { timeout: 10_000 },
  // Same CI-only retry budget as the e2e runner (`playwright.config.ts`), for the
  // transport-level noise a 4 vCPU runner produces (`read ECONNRESET`, a dropped
  // seed connection, a table rendering a beat late). Local stays 0, so the
  // admission gate — 3/3 independent runs, fresh tenant each — sees every flake.
  retries: process.env.CI ? 2 : 0,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  use: {
    baseURL: process.env.QA_APP_URL ?? 'http://localhost:3010',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
