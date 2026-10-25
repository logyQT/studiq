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

  // Run tests in files in parallel
  fullyParallel: true,

  // Fail the build on CI if you accidentally left test.only in the source code.
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Opt out of parallel tests on CI to avoid database/state race conditions.
  workers: process.env.CI ? 1 : undefined,

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
    {
      name: 'webkit',
      testIgnore: /[\\/]admin[\\/]/,
      use: { ...devices['Desktop Safari'] },
    },
    {
      // HTTP-level PEM tests against the admin app. Not a browser project: the
      // admin UI cannot sign requests in PEM mode.
      name: 'admin-api',
      testMatch: /[\\/]admin[\\/].*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:4000',
      },
    },
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
    {
      command: 'bun dev',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
    },
    {
      // The keyring is module-cached at boot, so a reused keyless server would
      // make the signed-request spec lie.
      command: 'bun dev:admin',
      url: 'http://localhost:4000',
      reuseExistingServer: false,
      timeout: 180 * 1000,
      env: { ADMIN_PEM_KEYS: adminRing },
    },
  ],
});
