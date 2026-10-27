import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test as base, expect, type Page } from '@playwright/test';
import { tenantKey } from '#test/e2e/fixtures/ids';

export interface TenantUser {
  id: string;
  email: string;
  password: string;
  role: 'teacher' | 'student';
  accountType: 'educator' | 'student';
}

export interface Tenant {
  key: string;
  file: string;
  title: string;
  project: string;
  profile: string;
  org: { id: string; name: string };
  users: Record<'teacher' | 'student', TenantUser>;
  ids: {
    group: string;
    deck: string;
    deck2: string;
    bank: string;
    bank2: string;
    quiz: string;
    assignment: string;
  };
}

const INDEX = join(process.cwd(), '__tests__/e2e/.seed/index.json');
let cache: Record<string, Tenant> | undefined;

function load(): Record<string, Tenant> {
  if (!cache) cache = JSON.parse(readFileSync(INDEX, 'utf8')) as Record<string, Tenant>;
  return cache;
}

type Fixtures = {
  /** This test's own org, users and ids — seeded before the run started. */
  tenant: Tenant;
  /** Sign the browser context in as one of the tenant's users (real API login). */
  loginAs: (role: 'teacher' | 'student') => Promise<void>;
};

/** Sign a page in as one of this test's users (works outside the fixture too). */
export async function signIn(page: Page, role: 'teacher' | 'student'): Promise<void> {
  const info = base.info();
  const key = tenantKey(info.file, info.title, info.project.name);
  const tenant = load()[key];
  if (!tenant) {
    throw new Error(`no seeded tenant for "${key}" — run \`bun scripts/e2e-seed.ts\``);
  }
  const user = tenant.users[role];
  const res = await page.request.post('/api/v1/auth/login', {
    data: { email: user.email, password: user.password },
  });
  if (!res.ok()) {
    throw new Error(`login ${role} (${user.email}) failed: ${res.status()} ${await res.text()}`);
  }
  // The suite asserts English copy in places; pin the locale the same way a
  // returning user would (next-intl reads NEXT_LOCALE).
  const baseURL = info.project.use.baseURL ?? 'http://localhost:3000';
  const host = new URL(baseURL).hostname;
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'en', domain: host, path: '/' }]);
  await page.goto('/login');
  await page.waitForURL(/\/(edu|app|manage)/, { timeout: 15_000 });
}

export const test = base.extend<Fixtures>({
  tenant: async ({}, use, testInfo) => {
    const key = tenantKey(testInfo.file, testInfo.title, testInfo.project.name);
    const tenant = load()[key];
    if (!tenant) {
      throw new Error(
        `no seeded tenant for "${key}" — run \`bun scripts/e2e-seed.ts\` (or unset E2E_SKIP_SEED)`,
      );
    }
    await use(tenant);
  },

  loginAs: async ({ page, tenant }, use) => {
    await use(async (role) => {
      const user = tenant.users[role];
      const res = await page.request.post('/api/v1/auth/login', {
        data: { email: user.email, password: user.password },
      });
      if (!res.ok()) {
        throw new Error(
          `login ${role} (${user.email}) failed: ${res.status()} ${await res.text()}`,
        );
      }
      // The cookies are set on the context; boot the app so the proxy redirects
      // to this account's dashboard before the spec starts clicking.
      // The suite asserts English copy in places; pin the locale the same way a
      // returning user would (next-intl reads NEXT_LOCALE).
      const baseURL = info.project.use.baseURL ?? 'http://localhost:3000';
      const host = new URL(baseURL).hostname;
      await page
        .context()
        .addCookies([{ name: 'NEXT_LOCALE', value: 'en', domain: host, path: '/' }]);
      await page.goto('/login');
      await page.waitForURL(/\/(edu|app|manage)/, { timeout: 15_000 });
    });
  },
});

export { expect };
