import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test as base, expect, type Page } from '@playwright/test';

/**
 * The tenant a case runs against. `bun scripts/qa-tenant.ts <CASEID>` writes
 * `qa/.tenants/<CASEID>.json` (attempt 0) plus one file per Playwright
 * attempt — `qa/.tenants/<CASEID>.r<repeat>e<retry>.json` — so a retry starts
 * from a pristine tenant. The spec never creates accounts itself.
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
  /**
   * Keyed by the account's `key`: the defaults are `manager` / `teacher` /
   * `teacher2` / `student` / `invitee*` (`two-org` tenants name each org's people
   * `studentA` / `teacherA` / `studentB`), and a declarative `members` / `solo`
   * roster in the case's profile file may add any key it declares.
   */
  users: Record<string, { id: string; email: string; password: string }>;
}

export type QaRole = keyof NonNullable<QaTenant['users']>;

const HOST = new URL(process.env.QA_APP_URL ?? 'http://localhost:3010').hostname;

const TENANTS_DIR = join(process.cwd(), 'qa', '.tenants');
const tenantCache = new Map<string, QaTenant>();

/**
 * The tenant file for the **current attempt**:
 * `qa/.tenants/<CASE>.r<repeat>e<retry>.json`.
 *
 * CI runs with `retries: 2` and `--repeat-each` replays a test, against the same
 * seed run. A retry must not inherit the failed attempt's writes, so
 * `scripts/qa-tenant.ts` seeds one tenant per `(repeat, retry)` and this is how
 * the spec picks its own. `test.info()` throws outside a test (module scope), in
 * which case the spec reads the base file (attempt 0).
 */
function attemptTenantPath(caseId: string): string | undefined {
  try {
    const info = test.info();
    return join(TENANTS_DIR, `${caseId}.r${info.repeatEachIndex}e${info.retry}.json`);
  } catch {
    return undefined;
  }
}

function tenantFor(caseId: string): QaTenant {
  const attemptPath = attemptTenantPath(caseId);
  // Inside a test the attempt file must exist: falling back to the base tenant
  // would silently run this attempt against the previous one's data (the exact
  // retry hazard the per-attempt files exist to remove). Outside a test (module
  // scope) the base file is the only thing available.
  if (attemptPath && !existsSync(attemptPath)) {
    throw new Error(
      `missing tenant for this attempt: ${attemptPath}. ` +
        `Seed it with \`bun scripts/qa-tenant.ts ${caseId} --attempts <retries + 1> ` +
        `--repeats <repeat-each>\`.`,
    );
  }
  const path = attemptPath ?? join(TENANTS_DIR, `${caseId}.json`);
  const cached = tenantCache.get(path);
  if (cached) return cached;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the file is written by scripts/qa-tenant.ts; a malformed tenant should fail loudly in the spec, not silently pass a generic shape
  const tenant = JSON.parse(readFileSync(path, 'utf8')) as QaTenant;
  tenantCache.set(path, tenant);
  return tenant;
}

/**
 * The tenant a case runs against.
 *
 * Returns a lazy view, not a snapshot: specs that derive ids at module scope get
 * them resolved when they are **used** (inside the attempt), so a retry reads
 * its own attempt's tenant instead of the first one's.
 */
export function loadTenant(caseId: string): QaTenant {
  return new Proxy({} as QaTenant, {
    get: (_target, property) => Reflect.get(tenantFor(caseId), property),
    has: (_target, property) => Reflect.has(tenantFor(caseId), property),
    ownKeys: () => Reflect.ownKeys(tenantFor(caseId) as object),
    getOwnPropertyDescriptor: (_target, property) => ({
      configurable: true,
      enumerable: true,
      value: Reflect.get(tenantFor(caseId), property),
    }),
  });
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
    // `maxRetries` only retries `ECONNRESET` (never an HTTP status), so a real
    // auth failure still surfaces. The server-side keep-alive fix removes the
    // dominant cause; this keeps a cold-start reset from failing the whole test.
    maxRetries: 2,
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
