import { cpus } from 'node:os';
import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';

/**
 * Shared Playwright config for the two runners in this repo: the product e2e
 * suite (`playwright.config.ts`) and the QA suite
 * (`__tests__/qa/playwright.qa.config.ts`).
 *
 * Only the settings that are genuinely common live here. The four
 * Playwright-global settings — `workers`, `reporter`, `globalSetup` and
 * `webServer` — stay explicitly owned by each config file: they cannot be set
 * per project, and each runner chooses them for its own reason.
 */
export function defineSuiteConfig(config: PlaywrightTestConfig): PlaywrightTestConfig {
  return defineConfig({
    // Both runners fail the build on a stray `test.only` and retry on CI only.
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    ...config,
  });
}

/**
 * e2e worker count: `E2E_WORKERS` when set, otherwise the CI runner's cores
 * (capped) or 8 locally.
 */
export function e2eWorkers(): number {
  const raw = Number(process.env.E2E_WORKERS);
  if (Number.isInteger(raw) && raw > 0) return raw;
  // One project is fastest at 8 (16 hammer the same app path); the full
  // matrix is fastest at 16 (the extra slots land on different projects).
  // On CI follow the runner: a 4-core GitHub runner cannot feed 16 browsers.
  return process.env.CI ? Math.max(2, Math.min(16, cpus().length)) : 8;
}
