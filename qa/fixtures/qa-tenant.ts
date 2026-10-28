import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test as base, expect, type Page } from '@playwright/test';

export interface QaUser {
  id: string;
  email: string;
  password: string;
}

/**
 * The tenant a case runs against. `bun scripts/qa-tenant.ts <CASEID>` writes
 * `qa/.tenants/<CASEID>.json`; the spec never creates accounts itself.
 */
export interface QaTenant {
  case: string;
  key: string;
  profile: 'content';
  org: { id: string; name: string };
  users: Record<'manager' | 'teacher' | 'student', QaUser>;
  group: { id: string; name: string };
}

/**
 * The `bare` profile: one educator with no organization and no group, for the
 * first-run onboarding cases. `bun scripts/qa-tenant.ts <CASEID> --profile bare`.
 */
export interface QaBareTenant {
  case: string;
  key: string;
  profile: 'bare';
  org: null;
  group: null;
  users: Record<'teacher', QaUser>;
}

export type QaRole = keyof QaTenant['users'];

const HOST = new URL(process.env.QA_APP_URL ?? 'http://localhost:3010').hostname;

function readTenant<T>(caseId: string): T {
  const path = join(process.cwd(), 'qa', '.tenants', `${caseId}.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function loadTenant(caseId: string): QaTenant {
  return readTenant<QaTenant>(caseId);
}

export function loadBareTenant(caseId: string): QaBareTenant {
  return readTenant<QaBareTenant>(caseId);
}

/**
 * Real login through the API — the app's only non-dev login path — then pin the
 * locale. The browser context keeps the auth cookie for the following
 * navigation, so a spec can assert exactly where the proxy sends the user.
 */
export async function signIn(page: Page, user: QaUser, locale: 'en' | 'pl' = 'en'): Promise<void> {
  const res = await page.request.post('/api/v1/auth/login', {
    data: { email: user.email, password: user.password },
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(`login (${user.email}) failed: ${res.status()} ${body}`);
  }
  await page
    .context()
    .addCookies([{ name: 'NEXT_LOCALE', value: locale, domain: HOST, path: '/' }]);
}

/** Sign in and boot the app at the account dashboard. */
export async function loginAs(page: Page, tenant: QaTenant, role: QaRole): Promise<void> {
  await signIn(page, tenant.users[role]);
  await page.goto('/login');
  await page.waitForURL(/\/(edu|app|manage)/, { timeout: 15_000 });
}

export const test = base;
export { expect };
