import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test as base, expect, type Page } from '@playwright/test';

/**
 * The tenant a case runs against. `bun scripts/qa-tenant.ts <CASEID>` writes
 * `qa/.tenants/<CASEID>.json`; the spec never creates accounts itself.
 *
 * A `bare` tenant is the first-run state: one educator, no organization and no
 * group. It is seeded with `--profile bare --fresh`, so the account has never
 * onboarded.
 */
export interface QaTenant {
  case: string;
  key: string;
  profile?: 'content' | 'bare';
  runSuffix?: string | null;
  org: { id: string; name: string } | null;
  group: { id: string; name: string } | null;
  users: Partial<
    Record<'manager' | 'teacher' | 'student', { id: string; email: string; password: string }>
  >;
}

export type QaRole = keyof NonNullable<QaTenant['users']>;

const HOST = new URL(process.env.QA_APP_URL ?? 'http://localhost:3010').hostname;

export function loadTenant(caseId: string): QaTenant {
  const path = join(process.cwd(), 'qa', '.tenants', `${caseId}.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as QaTenant;
}

export interface LoginOptions {
  /** UI language for the run. The default matches the legacy e2e fixture. */
  locale?: 'en' | 'pl';
  /** URL the app must reach after login (default: any account dashboard). */
  waitFor?: RegExp;
}

/** Real login through the API, then boot the app; the context keeps the cookie. */
export async function loginAs(
  page: Page,
  tenant: QaTenant,
  role: QaRole,
  options: LoginOptions = {},
): Promise<void> {
  const user = tenant.users[role];
  if (!user) {
    throw new Error(`tenant ${tenant.case} has no seeded ${role} user`);
  }
  const res = await page.request.post('/api/v1/auth/login', {
    data: { email: user.email, password: user.password },
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(`login ${role} (${user.email}) failed: ${res.status()} ${body}`);
  }
  // The suite asserts English copy in places; pin the locale a returning user would have.
  await page
    .context()
    .addCookies([{ name: 'NEXT_LOCALE', value: options.locale ?? 'en', domain: HOST, path: '/' }]);
  await page.goto('/login');
  await page.waitForURL(options.waitFor ?? /\/(edu|app|manage)/, { timeout: 15_000 });
}

export const test = base;
export { expect };
