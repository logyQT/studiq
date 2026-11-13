import { devices } from '@playwright/test';
import { defineSuiteConfig } from '#playwright/base';

/**
 * QA-suite runner: one shared app + one shared Supabase, one spec per case.
 *
 *   bunx playwright test -c __tests__/qa/playwright.qa.config.ts __tests__/qa/<AREA>/<CASEID>.spec.ts --workers=1
 *
 * Local: keep `workers` at 1 — the dev box also hosts the app, Supabase and the
 * eight browser tiles, and a parallel run OOM-kills it. CI sets QA_WORKERS (each
 * test owns its tenant, so parallel is safe there).
 */
export default defineSuiteConfig({
  // `testDir` resolves relative to this config file, so `.` is `__tests__/qa`.
  testDir: '.',
  fullyParallel: false,
  workers: Number(process.env.QA_WORKERS ?? 1),
  // The per-test budget for a whole long flow stays generous (this box also
  // hosts Supabase and the Next app). Per-action and per-assertion waits are the
  // shared 3 s default from `defineSuiteConfig`, navigation 6 s: a broken step
  // must fail fast, so a spec that needs longer overrides that call explicitly.
  timeout: 90_000,
  // `defineSuiteConfig` owns the CI-only retry budget and `forbidOnly`. Local
  // retries stay 0, so the admission gate — 3/3 independent runs, fresh tenant
  // each — sees every flake.
  reporter: [['list']],
  use: {
    baseURL: process.env.QA_APP_URL ?? 'http://localhost:3010',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
