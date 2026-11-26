import { devices } from '@playwright/test';
import { resolveQaAppUrl } from '#test/helpers/qa-pointer';
import { defineSuiteConfig } from '#playwright/base';

/**
 * QA-suite runner: one spec per case, one isolated tenant per case (and per
 * attempt), against whatever app `QA_APP_URL` names.
 *
 *   bunx playwright test -c __tests__/qa/playwright.qa.config.ts __tests__/qa/<AREA>/<CASEID>.spec.ts --workers=1
 *
 * Local: keep `workers` at 1 — the same machine also hosts the app, Supabase and
 * the browser you are watching, and a parallel run OOM-kills it. CI sets
 * QA_WORKERS (each test owns its tenant, so parallel is safe there).
 */
export default defineSuiteConfig({
  // `testDir` resolves relative to this config file, so `.` is `__tests__/qa`.
  testDir: '.',
  // Fails a run that was not told which app to hit before its first test (#1286).
  globalSetup: './fixtures/require-app-url.ts',
  fullyParallel: false,
  workers: Number(process.env.QA_WORKERS ?? 1),
  // The per-test budget for a whole long flow stays generous (this box also
  // hosts Supabase and the Next app). Per-action and per-assertion waits are the
  // shared 4 s default from `defineSuiteConfig`, navigation 6 s: a broken step
  // must fail fast, so a spec that needs longer overrides that call explicitly.
  timeout: 90_000,
  // `defineSuiteConfig` owns the CI-only retry budget and `forbidOnly`. Local
  // retries stay 0, so the admission gate — 5/5 independent runs, fresh tenant
  // each — sees every flake.
  reporter: [['list']],
  use: {
    // `QA_APP_URL` when a consumer is told which app to hit, else the pointer
    // `env:share` wrote; outside CI nothing else (#1286). Unresolved stays undefined
    // here and `globalSetup` refuses the run, instead of falling back to the shared
    // `:3010` app.
    baseURL: resolveQaAppUrl() ?? undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
