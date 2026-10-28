/**
 * QA-suite tenant fixture.
 *
 * `bun scripts/qa-tenant.ts <CASEID>` writes `qa/.tenants/<CASEID>.json` with a
 * deterministic org/user graph (`tenantKey("<case file>", "<CASEID>", "qa-shared")`).
 * The spec reads that file instead of hard-coding UUIDs, and verifies the key so a
 * stale file for another case can never be used silently.
 *
 * Nothing here talks to the database: seeding is the worker's job before the run.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { tenantKey } from '#test/e2e/fixtures/ids';

/** Locale used by the QA suite: the product copy (and the test plan) is Polish. */
export const QA_LOCALE = 'pl';

export type QaTenantRole = 'manager' | 'teacher' | 'student';

export interface QaTenantUser {
  id: string;
  email: string;
  password: string;
}

export interface QaTenant {
  case: string;
  key: string;
  org: { id: string; name: string };
  users: Record<QaTenantRole, QaTenantUser>;
  group: { id: string; name: string };
}

const CACHE = new Map<string, QaTenant>();

/** Read the tenant file written by `scripts/qa-tenant.ts <CASEID>`. */
export function loadQaTenant(caseId: string): QaTenant {
  const cached = CACHE.get(caseId);
  if (cached) return cached;

  const path = join(process.cwd(), 'qa', '.tenants', `${caseId}.json`);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error(
      `no seeded tenant for ${caseId} (${path} is missing) — run \`bun scripts/qa-tenant.ts ${caseId}\` against the shared Supabase first`,
    );
  }

  const tenant = JSON.parse(raw) as QaTenant;
  const expectedKey = tenantKey(`qa/cases/${caseId}.md`, caseId, 'qa-shared');
  if (tenant.key !== expectedKey) {
    throw new Error(
      `tenant file ${path} belongs to key "${tenant.key}", expected "${expectedKey}" — re-run the seeder`,
    );
  }

  CACHE.set(caseId, tenant);
  return tenant;
}

/**
 * Sign the browser context in as one of the tenant's users (real API login, no form).
 *
 * `NEXT_LOCALE` pins the UI language before the first request; `active_org_id` pins
 * the tenant org the same way the app does after a switch.
 */
export async function signInAs(
  page: Page,
  tenant: QaTenant,
  role: QaTenantRole = 'student',
): Promise<void> {
  const user = tenant.users[role];

  await page.goto('/login');
  const origin = new URL(page.url()).origin;
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: QA_LOCALE, url: origin }]);

  const response = await page.request.post('/api/v1/auth/login', {
    data: { email: user.email, password: user.password },
  });
  if (!response.ok()) {
    throw new Error(
      `login ${role} (${user.email}) failed: ${response.status()} ${await response.text()}`,
    );
  }

  await page
    .context()
    .addCookies([{ name: 'active_org_id', value: tenant.org.id, url: origin, httpOnly: true }]);
}

/** Pin the UI language for an anonymous context. */
export async function pinLocale(page: Page): Promise<void> {
  await page.goto('/login');
  const origin = new URL(page.url()).origin;
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: QA_LOCALE, url: origin }]);
}
