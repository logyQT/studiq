/**
 * QA-suite tenant helpers.
 *
 * The tenant is seeded once per case with `bun scripts/qa-tenant.ts <CASEID>`.
 * Its ids and credentials are derived from the same primitives the e2e fixtures
 * use (`tenantKey` + `buildAccount`), so a spec never hardcodes an id and never
 * has to read `qa/.tenants/*.json`.
 */
import type { Page } from '@playwright/test';
import { tenantKey } from '#test/e2e/fixtures/ids';
import { buildAccount, tenantId, type SeedAccount } from '#test/helpers/tenant-seed';

export type QaRole = 'manager' | 'teacher' | 'student';

export interface QaTenant {
  /** `qa/cases/<CASEID>.md::<CASEID>::qa-shared` */
  key: string;
  orgId: string;
  groupId: string;
  users: Record<QaRole, SeedAccount>;
}

/** Deterministic tenant graph for one QA case (see scripts/qa-tenant.ts). */
export function qaTenant(caseId: string): QaTenant {
  const key = tenantKey(`qa/cases/${caseId}.md`, caseId, 'qa-shared');

  return {
    key,
    orgId: tenantId(key, 'org'),
    groupId: tenantId(key, 'group:default'),
    users: {
      manager: buildAccount(key, 'manager', 'manager', { name: 'QA manager' }),
      teacher: buildAccount(key, 'teacher', 'educator', { name: 'QA teacher' }),
      student: buildAccount(key, 'student', 'student', { name: 'QA student' }),
    },
  };
}

/**
 * Sign the current browser context in as one of the case's users through the
 * real API (never the login form, never a legacy manual account), then pin the
 * locale and the tenant's active organization the same way a returning user
 * would.
 */
export async function signInAs(
  page: Page,
  tenant: QaTenant,
  role: QaRole,
  baseURL: string,
): Promise<void> {
  const user = tenant.users[role];
  const response = await page.request.post('/api/v1/auth/login', {
    data: { email: user.email, password: user.password },
  });
  if (!response.ok()) {
    throw new Error(
      `login as tenant ${role} (${user.email}) failed: ${response.status()} ${await response.text()} — seed it with \`bun scripts/qa-tenant.ts\``,
    );
  }

  const { hostname } = new URL(baseURL);
  await page.context().addCookies([
    { name: 'NEXT_LOCALE', value: 'pl', domain: hostname, path: '/' },
    { name: 'active_org_id', value: tenant.orgId, domain: hostname, path: '/', httpOnly: true },
  ]);
}
