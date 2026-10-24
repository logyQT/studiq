import { resolve } from 'node:path';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? process.env.APP_URL ?? 'http://localhost:3000';

// Plain config object on purpose: the runner lives in the slot's node_modules,
// while this file lives in the qa-env worktree. Importing @playwright/test here
// would load a second copy and break Playwright.
export default {
  testDir: resolve(process.cwd(), '__tests__/e2e'),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
};
