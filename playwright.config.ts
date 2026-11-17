import { devices } from '@playwright/test';
import { defineSuiteConfig, e2eWorkers } from './playwright/base';

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineSuiteConfig({
  // Directory where your E2E tests are located
  testDir: './__tests__/e2e',

  // Seeds one isolated tenant per test before the suite starts (scripts/e2e-seed.ts).
  globalSetup: './__tests__/e2e/global-setup.ts',

  // Run tests in files in parallel
  fullyParallel: true,

  workers: e2eWorkers(),

  // Reporter to use. See https://playwright.dev/docs/test-reporters
  reporter: 'html',

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // WebKit is opt-in while its login-form race is unresolved (#known-failures
    // → deferredWork e2e-webkit-login-form): E2E_INCLUDE_WEBKIT=1.
    ...(process.env.E2E_INCLUDE_WEBKIT === '1'
      ? [{ name: 'webkit', use: { ...devices['Desktop Safari'] } }]
      : []),
  ],

  // Production build, never `bun dev`: the dev server compiles on demand, so a
  // cold route change can blow past a spec's action timeout, and under parallel
  // workers it is the difference between a real failure and a timeout. The
  // build is a no-op (~1 s) when nothing changed.
  //
  // `env:build --no-slot` is the only build command that mints the grant the
  // `prebuild` guard demands (ADR-0014, decision 6); it claims no slot and no
  // lease because this machine runs one build. It resolves the stack contract,
  // so E2E needs a live stack **and** that contract exported: either run against
  // the server `bun run env:ensure --profile web` left up (Playwright reuses it),
  // or run the suite through `bun run env:run -- bunx playwright test` so
  // `bun run start` inherits the contract. With the server down and no contract,
  // `bun run start` 500s.
  webServer:
    process.env.E2E_SKIP_WEB_WS === '1'
      ? []
      : [
          {
            command: 'bun run env:build --no-slot && bun run start',
            url: 'http://localhost:3000',
            reuseExistingServer: !process.env.CI,
            timeout: 300 * 1000,
          },
        ],
});
