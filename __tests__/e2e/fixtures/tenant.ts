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
    topic: string;
    card: string;
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

function tenantFor(info: { file: string; title: string; project: { name: string } }): Tenant {
  const key = tenantKey(info.file, info.title, info.project.name);
  const tenant = load()[key];
  if (!tenant) {
    throw new Error(
      `no seeded tenant for "${key}" — run \`bun scripts/e2e-seed.ts\` (or unset E2E_SKIP_SEED)`,
    );
  }
  return tenant;
}

async function login(
  page: Page,
  tenant: Tenant,
  role: 'teacher' | 'student',
  baseURL: string,
): Promise<void> {
  const user = tenant.users[role];
  const res = await page.request.post('/api/v1/auth/login', {
    data: { email: user.email, password: user.password },
  });
  if (!res.ok()) {
    throw new Error(
      `login ${user.role} (${user.email}) failed: ${res.status()} ${await res.text()}`,
    );
  }
  // The suite asserts English copy in places; pin the locale the same way a
  // returning user would (next-intl reads NEXT_LOCALE).
  const host = new URL(baseURL).hostname;
  await page.context().addCookies([
    { name: 'NEXT_LOCALE', value: 'en', domain: host, path: '/' },
    // Tenant isolation: a seeded user belongs to exactly one org, but the app
    // only writes this hint when an org is created or switched. Without it the
    // dashboard races to pick one and `withAuth` scopes the first requests to no
    // org at all (scopes then fall back to `own`).
    { name: 'active_org_id', value: tenant.org.id, domain: host, path: '/', httpOnly: true },
  ]);
  // Boot the app so the proxy redirects to this account's dashboard before the
  // spec starts clicking.
  await page.goto('/login');
  await page.waitForURL(/\/(edu|app|manage)/, { timeout: 15_000 });
}

/** Sign a page in as one of this test's users (works outside the fixture too). */
export async function signIn(page: Page, role: 'teacher' | 'student'): Promise<void> {
  const info = base.info();
  const tenant = tenantFor(info);
  await login(page, tenant, role, info.project.use.baseURL ?? 'http://localhost:3000');
}

export const test = base.extend<Fixtures>({
  tenant: async ({}, use, testInfo) => {
    await use(tenantFor(testInfo));
  },

  loginAs: async ({ page, tenant }, use, testInfo) => {
    await use((role) =>
      login(page, tenant, role, testInfo.project.use.baseURL ?? 'http://localhost:3000'),
    );
  },
});

export { expect };
