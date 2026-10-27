import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test as base, expect } from '@playwright/test';
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
      await page.goto('/login');
      await page.waitForURL(/\/(edu|app|manage)/, { timeout: 15_000 });
    });
  },
});

export { expect };
