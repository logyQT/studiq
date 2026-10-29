import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test as base, expect, type Page } from '@playwright/test';

/**
 * The tenant a case runs against. `bun scripts/qa-tenant.ts <CASEID>` writes
 * `qa/.tenants/<CASEID>.json`; the spec never creates accounts itself.
 *
 * A `bare` tenant is the first-run state: one staff account, no organization and
 * no group. It is seeded with `--profile bare --role <manager|teacher> --fresh`,
 * so the account has never onboarded.
 *
 * An `org-limit` tenant sits one seat below its plan capacity (`ONB-10`): an org
 * with an admin, two teachers and one member, plus two invitee accounts that are
 * **not** org members, so they can accept an invitation through `/app/join`.
 *
 * A `two-org` tenant (`MGR-03`, `SEC-02`) is one manager who administers two
 * organizations; `org` mirrors the first one and `orgA` / `orgB` carry each
 * organization's people and group names (see `scripts/qa-tenant.ts`).
 */
export interface QaTenant {
  case: string;
  key: string;
  profile?: 'content' | 'bare' | 'org-limit' | 'two-org';
  /** Account type of the single user in a `bare` tenant. */
  role?: 'teacher' | 'manager' | 'student';
  runSuffix?: string | null;
  /** Organization plan the seeder applied (`--plan`), e.g. `hub` for `role.builder`. */
  plan?: string | null;
  org: { id: string; name: string } | null;
  group: { id: string; name: string } | null;
  users: Partial<
    Record<
      | 'manager'
      | 'teacher'
      | 'teacher2'
      | 'student'
      // `two-org` tenants name each org's people explicitly (`MGR-03`, `SEC-02`).
      | 'studentA'
      | 'teacherA'
      | 'studentB'
      | 'invitee1'
      | 'invitee2',
      { id: string; email: string; password: string }
    >
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
  /**
   * Active-org cookie to seed. Defaults to the tenant's org; pass `null` for a
   * tenant user who is not a member of it (e.g. an invitee before accepting).
   */
  activeOrgId?: string | null;
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
  const cookies: {
    name: string;
    value: string;
    domain: string;
    path: string;
    httpOnly?: boolean;
  }[] = [{ name: 'NEXT_LOCALE', value: options.locale ?? 'en', domain: HOST, path: '/' }];
  // The app only writes `active_org_id` when an org is created or switched, so a
  // seeded membership starts with no org context: `withAuth` would scope the
  // first requests to no org at all.
  const activeOrgId = options.activeOrgId === undefined ? tenant.org?.id : options.activeOrgId;
  if (activeOrgId) {
    cookies.push({
      name: 'active_org_id',
      value: activeOrgId,
      domain: HOST,
      path: '/',
      httpOnly: true,
    });
  }
  await page.context().addCookies(cookies);
  await page.goto('/login');
  await page.waitForURL(options.waitFor ?? /\/(edu|app|manage)/, { timeout: 15_000 });
}

export const test = base;
export { expect };
