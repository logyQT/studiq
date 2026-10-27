import { cpus } from 'node:os';
import { defineConfig, devices } from '@playwright/test';
import { deterministicAdminTestKey, ringEntry, ringJson } from '#test/helpers/admin-pem';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config({ path: path.resolve(__dirname, '.env') });

/**
 * Ring used by the `:4000` admin server in the `admin-api` project. Derived from
 * a fixed public seed so config evaluation and test workers agree without
 * committing a private key. Only `feature-flags:read` is granted — the E2E spec
 * asserts the scope denial for `users`.
 */
const adminRing = ringJson([
  ringEntry(deterministicAdminTestKey('e2e-admin'), { scopes: ['feature-flags:read'] }),
]);

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  // Directory where your E2E tests are located
  testDir: './__tests__/e2e',

  // Seeds one isolated tenant per test before the suite starts (scripts/e2e-seed.ts).
  globalSetup: './__tests__/e2e/global-setup.ts',

  // Run tests in files in parallel
  fullyParallel: true,

  // Fail the build on CI if you accidentally left test.only in the source code.
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  workers: (() => {
    const raw = Number(process.env.E2E_WORKERS);
    if (Number.isInteger(raw) && raw > 0) return raw;
    // One project is fastest at 8 (16 hammer the same app path); the full
    // matrix is fastest at 16 (the extra slots land on different projects).
    // On CI follow the runner: a 4-core GitHub runner cannot feed 16 browsers.
    return process.env.CI ? Math.max(2, Math.min(16, cpus().length)) : 8;
  })(),

  // Reporter to use. See https://playwright.dev/docs/test-reporters
  reporter: 'html',

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      testIgnore: /[\\/]admin[\\/]/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      testIgnore: /[\\/]admin[\\/]/,
      use: { ...devices['Desktop Firefox'] },
    },
    // WebKit is opt-in while its login-form race is unresolved (#known-failures
    // → deferredWork e2e-webkit-login-form): E2E_INCLUDE_WEBKIT=1.
    ...(process.env.E2E_INCLUDE_WEBKIT === '1'
      ? [
          {
            name: 'webkit',
            testIgnore: /[\\/]admin[\\/]/,
            use: { ...devices['Desktop Safari'] },
          },
        ]
      : []),
    // HTTP-level PEM tests against the admin app. Not a browser project: the
    // admin UI cannot sign requests in PEM mode. Opt-in (nightly): the admin
    // build + server cost outweighs three assertions on every PR, and the gate
    // logic itself is unit-tested (__tests__/unit/proxy/admin-pem-gate).
    ...(process.env.E2E_INCLUDE_ADMIN === '1'
      ? [
          {
            name: 'admin-api',
            testMatch: /[\\/]admin[\\/].*\.spec\.ts/,
            use: {
              ...devices['Desktop Chrome'],
              baseURL: 'http://localhost:4000',
            },
          },
        ]
      : []),
    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },
  ],

  webServer: [
    // Production build, never `bun dev`: the dev server compiles on demand, so
    // a cold route change can blow past a spec's action timeout, and under
    // parallel workers it is the difference between a real failure and a
    // timeout. The build is a no-op (~1 s) when nothing changed.
    ...(process.env.E2E_SKIP_WEB_WS === '1'
      ? []
      : [
          {
            command: 'bun run build && bun run start',
            url: 'http://localhost:3000',
            reuseExistingServer: !process.env.CI,
            timeout: 300 * 1000,
          },
        ]),
    // The admin API project needs its own server (the keyring is module-cached
    // at boot, so a reused keyless server would make the signed-request spec
    // lie). Skip it locally with E2E_SKIP_ADMIN_WS=1 when :4000 is not free.
    ...(process.env.E2E_SKIP_ADMIN_WS === '1' || process.env.E2E_INCLUDE_ADMIN !== '1'
      ? []
      : [
          {
            command: 'bun run build:admin && bun run start:admin',
            url: 'http://localhost:4000',
            reuseExistingServer: false,
            timeout: 300 * 1000,
            env: { ADMIN_PEM_KEYS: adminRing },
          },
        ]),
  ],
});
