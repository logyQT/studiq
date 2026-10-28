import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { shortHash, tenantKey } from '#test/e2e/fixtures/ids';
import {
  buildAccount,
  createSeedDb,
  randomTag,
  seedTenantGraph,
  tenantId,
  type SeedAccount,
} from '#test/helpers/tenant-seed';

/**
 * MGR-MEM-01 — the members list: search, role filter, counters and the
 * per-row affordances.
 *
 * Prerequisite (reconciled with the tenant seeder): a signed-in organization
 * manager; the legacy `manager@dev.local` / `student1@dev.local` accounts and
 * the password `pass` are never used.
 *
 * Tenant: `tenantKey('qa/cases/MGR-MEM-01.md', <title>, 'qa-shared')::<run>`.
 * The spec seeds its own graph through the shared helpers
 * (`__tests__/helpers/tenant-seed.ts`) on every run, so no two independent runs
 * share an organization or a row:
 *
 * - the manager (org `admin`) and the default group `G1`;
 * - the teacher (org `teacher`) — the tenant counterpart of `T1`, so the
 *   "Nauczyciel"/"Teacher" filter has a row to keep;
 * - a student (org `member`) — the counterpart of `S1`, searched by e-mail;
 * - a second `member` with an **empty full name**, so the list has a real row
 *   for the "Bez imienia" fallback. The product's registration form requires a
 *   name, so the state is seeded directly instead of stubbed.
 *
 * Nothing global is written (no admin setting, feature flag, plan, platform
 * stat or singleton row) and no other case's tenant is touched.
 *
 * Two deliberate deviations from the manual document, recorded in
 * `qa/cases/MGR-MEM-01.md` under "Observed during the suite walk":
 *
 * 1. The document enumerates the columns as Członek, Rola, Dołączył, Grupy,
 *    Akcje; the page has rendered Grupy before Dołączył since the groups column
 *    landed. All five columns exist with the right content, so the test pins the
 *    set of headers, not the stale order.
 * 2. The document quotes the role filter as „Nauczyciel”/„Członek”; the filter
 *    renders the system roles' display names (Admin/Teacher/Student), as every
 *    other role picker in the app does. That is a P3 wording drift (the manual
 *    doc lists text mismatches as language notes, not functional errors); the
 *    filtering behaviour is what the test asserts.
 */

const CASE_FILE = 'qa/cases/MGR-MEM-01.md';
const TITLE = 'MGR-MEM-01 members search and role filter';
const PROJECT = 'qa-shared';
const RUN_SUFFIX = process.env.QA_RUN_SUFFIX ?? `${Date.now().toString(36)}-${randomTag(4)}`;
const KEY = `${tenantKey(CASE_FILE, TITLE, PROJECT)}::${RUN_SUFFIX}`;

/** The organization's default group; the seeder enrolls every member in it. */
const GROUP_NAME = 'G1';

/** Supabase local defaults (the service-role JWT is the public `supabase start` demo key). */
const LOCAL_SUPABASE_URL = 'http://localhost:54421';
const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

/** Polish copy from `ManageMembersPage` and the organization role defaults. */
const COPY = {
  title: 'Członkowie',
  searchPlaceholder: 'Szukaj członków',
  roleFilter: 'Filtruj po roli',
  allRoles: 'Wszystkie role',
  self: '(ty)',
  unnamed: 'Bez imienia',
  manageGroups: 'Zarządzaj grupami',
} as const;

/** The system roles' `display_name` (seeded by the migration; not translated). */
const ROLE_LABEL = { admin: 'Admin', teacher: 'Teacher', member: 'Student' } as const;
type OrgRoleName = keyof typeof ROLE_LABEL;

const HEADERS = ['Członek', 'Rola', 'Grupy', 'Dołączył', 'Akcje'] as const;

interface CaseTenant {
  key: string;
  org: { id: string; name: string };
  manager: SeedAccount;
  teacher: SeedAccount;
  student: SeedAccount;
  unnamed: SeedAccount;
}

interface Member {
  id: string;
  email: string;
  full_name: string | null;
  orgRoleName: OrgRoleName;
  orgRoleId: string;
  created_at: string;
  groups: Array<{ id: string; name: string; role: string }>;
}

interface OrgRole {
  id: string;
  name: string;
  displayName: string;
  isSystem: boolean;
}

/** Resolve the shared Supabase admin credentials (env → worker config → local defaults). */
function resolveSupabase(): { url: string; serviceKey: string } {
  let fromEnvJson: string | undefined;
  try {
    const raw = readFileSync(join(process.cwd(), 'qa', 'env.json'), 'utf8');
    fromEnvJson = (JSON.parse(raw) as { supabaseUrl?: string }).supabaseUrl;
  } catch {
    // qa/env.json is worker-local and gitignored; absence is fine.
  }

  return {
    url:
      process.env.QA_SUPABASE_URL ??
      process.env.NEXT_PUBLIC_SUPABASE_URL ??
      fromEnvJson ??
      LOCAL_SUPABASE_URL,
    serviceKey:
      process.env.QA_SUPABASE_SERVICE_ROLE_KEY ??
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      LOCAL_SERVICE_ROLE_KEY,
  };
}

function accountEmail(role: string): string {
  return `qa+${shortHash(`${KEY}:${role}`)}+${role}@test.local`;
}

/**
 * One organization with four members, so every expected row of the case exists:
 * an admin (the logged-in manager), a teacher, a named student and a member with
 * no name at all.
 */
async function seedCaseTenant(): Promise<CaseTenant> {
  const org = { id: tenantId(KEY, 'org'), name: `qa-mgr-mem-01-${RUN_SUFFIX}` };
  const groupId = tenantId(KEY, 'group:default');
  const manager = buildAccount(KEY, 'manager', 'manager', {
    email: accountEmail('manager'),
    name: 'QA manager',
  });
  const teacher = buildAccount(KEY, 'teacher', 'educator', {
    email: accountEmail('teacher'),
    name: 'QA teacher',
    orgRole: 'teacher',
  });
  const student = buildAccount(KEY, 'student', 'student', {
    email: accountEmail('student'),
    name: 'QA student',
  });
  // `name: ''` reaches `profiles.full_name` as an empty value (the trigger copies
  // the user metadata verbatim), which is the "no name" state the page falls back
  // on. It is a real member row, not a mocked response.
  const unnamed = buildAccount(KEY, 'unnamed', 'student', {
    email: accountEmail('unnamed'),
    name: '',
  });

  const { url, serviceKey } = resolveSupabase();
  const db = createSeedDb({ url, serviceKey });

  const seeded = await seedTenantGraph(db, {
    key: KEY,
    org,
    defaultGroup: { id: groupId, name: GROUP_NAME, isDefault: true },
    extraGroups: [],
    owner: manager,
    members: [teacher, student, unnamed],
    ownerOrgRole: 'admin',
  });

  return {
    key: KEY,
    org,
    manager: seeded.owner,
    teacher: seeded.members[0],
    student: seeded.members[1],
    unnamed: seeded.members[2],
  };
}

/**
 * Real login through the API, then boot the app with the locale the case's copy is
 * written in and the tenant's organization active (the cookie the app writes when
 * an organization is created or switched).
 */
async function loginAsManager(page: Page, baseURL: string, tenant: CaseTenant): Promise<void> {
  const response = await page.request.post('/api/v1/auth/login', {
    data: { email: tenant.manager.email, password: tenant.manager.password },
  });
  expect(response.status(), `login ${tenant.manager.email}`).toBe(200);

  const { hostname } = new URL(baseURL);
  await page.context().addCookies([
    { name: 'NEXT_LOCALE', value: 'pl', domain: hostname, path: '/' },
    { name: 'active_org_id', value: tenant.org.id, domain: hostname, path: '/', httpOnly: true },
  ]);

  await page.goto('/login');
  await expect(page).toHaveURL(/\/manage$/, { timeout: 20_000 });
}

async function getData<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path);
  expect(response.status(), `GET ${path}`).toBe(200);
  const body = (await response.json()) as { success: boolean; data: T };
  expect(body.success, `GET ${path} success`).toBe(true);
  return body.data;
}

function listMembers(page: Page): Promise<Member[]> {
  return getData<Member[]>(page, '/api/v1/organization/members');
}

function listRoles(page: Page): Promise<OrgRole[]> {
  return getData<OrgRole[]>(page, '/api/v1/organization/roles');
}

/**
 * The page's own rows. The "nothing matches" placeholder is also a `<tr>`, so a
 * bare `tbody tr` count would be off by one on an empty result.
 */
function memberRows(page: Page) {
  return page
    .locator('table tbody tr')
    .filter({ has: page.locator('[data-testid="member-role"]') });
}

function rowFor(page: Page, email: string) {
  return memberRows(page).filter({ hasText: email });
}

/** A member's row label is their name, or their e-mail when the profile has none. */
function displayName(member: Member): string {
  return member.full_name || member.email;
}

test.describe('@case:MGR-MEM-01 @area:MGR @prio:P1 members search and role filter', () => {
  let tenant: CaseTenant;

  test.beforeAll(async () => {
    tenant = await seedCaseTenant();
    // Evidence for a failing run: the deterministic tenant this run owns.
    console.log(
      `MGR-MEM-01 tenant key: ${tenant.key} (org ${tenant.org.id}, manager ${tenant.manager.email})`,
    );
  });

  test('lists every member, searches by name and e-mail, and narrows by role', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(120_000);

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await loginAsManager(page, baseURL ?? 'http://localhost:3010', tenant);

    // The server state every assertion below is derived from: four members, one
    // per role that the filter offers, plus the nameless one.
    const members = await listMembers(page);
    expect(members, 'the seeded organization has four members').toHaveLength(4);
    expect(
      members.filter((member) => member.orgRoleName === 'admin').map((member) => member.email),
      'exactly one admin (the signed-in manager)',
    ).toEqual([tenant.manager.email]);
    expect(
      members.filter((member) => member.orgRoleName === 'teacher').map((member) => member.email),
      'exactly one teacher',
    ).toEqual([tenant.teacher.email]);
    expect(
      members.filter((member) => member.orgRoleName === 'member').map((member) => member.email),
      'two members',
    ).toHaveLength(2);

    const roles = await listRoles(page);
    expect(
      roles.filter((role) => role.isSystem).map((role) => role.displayName),
      'the organization offers the three system roles',
    ).toEqual(expect.arrayContaining([ROLE_LABEL.admin, ROLE_LABEL.teacher, ROLE_LABEL.member]));

    // --- Step 1: /manage/members ------------------------------------------
    await page.goto('/manage/members');
    await expect(page).toHaveURL(/\/manage\/members$/, { timeout: 20_000 });
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
    await expect(
      page.getByRole('heading', { level: 2, name: COPY.title, exact: true }),
    ).toBeVisible();

    // --- Expected result: the counter and the five columns -----------------
    const counter = page.getByText(`${members.length} łącznie`, { exact: true });
    await expect(
      counter,
      'the counter is the whole organization, not the filtered rows',
    ).toBeVisible();

    const headers = await page
      .locator('table thead th')
      .evaluateAll((cells) => cells.map((cell) => (cell.textContent ?? '').trim()));
    expect(new Set(headers), 'the table has exactly the five documented columns').toEqual(
      new Set(HEADERS),
    );
    expect(headers, 'no duplicated column').toHaveLength(HEADERS.length);

    // --- Expected result: one row per member, with role, groups and actions --
    await expect(memberRows(page)).toHaveCount(members.length);

    for (const member of members) {
      const row = rowFor(page, member.email);
      await expect(row, `${member.email} has one row`).toHaveCount(1);
      await expect(row.getByText(displayName(member), { exact: true })).toBeVisible();
      await expect(row.getByText(member.email, { exact: true })).toBeVisible();
      await expect(row.getByTestId('member-role')).toHaveText(ROLE_LABEL[member.orgRoleName]);
      for (const group of member.groups) {
        await expect(row.getByText(group.name, { exact: true })).toBeVisible();
      }
      // `formatDate(..., 'pl')` → dd.MM.yyyy, never an empty cell.
      await expect(row).toContainText(/\d{2}\.\d{2}\.\d{4}/);

      if (member.id === tenant.manager.id) {
        // --- Expected result: the own account is marked and not actionable --
        await expect(row.getByText(COPY.self, { exact: true })).toBeVisible();
        await expect(row.getByRole('button'), 'own row offers no action').toHaveCount(0);
        await expect(row.getByRole('combobox'), 'own row offers no role select').toHaveCount(0);
      } else {
        await expect(row.getByText(COPY.self, { exact: true })).toHaveCount(0);
        await expect(
          row.getByRole('button', { name: COPY.manageGroups, exact: true }),
        ).toBeVisible();
        await expect(row.getByRole('combobox'), 'the role is editable in place').toHaveCount(1);
        await expect(
          row.getByRole('button', { name: `Usuń członka ${displayName(member)}`, exact: true }),
        ).toBeVisible();
      }
    }

    // The member with an empty full name gets the documented fallback, and still
    // carries its e-mail so the manager can tell the rows apart.
    const unnamedRow = rowFor(page, tenant.unnamed.email);
    await expect(unnamedRow.locator('p').first()).toHaveText(COPY.unnamed);
    await expect(unnamedRow.locator('p').nth(1)).toHaveText(tenant.unnamed.email);

    // --- Step 2: search by name, then by e-mail, case-insensitively --------
    const search = page.getByPlaceholder(COPY.searchPlaceholder);

    await search.fill('TEACHER'); // upper-case query, lower-case name in the profile
    await expect(memberRows(page)).toHaveCount(1);
    await expect(rowFor(page, tenant.teacher.email)).toHaveCount(1);
    await expect(rowFor(page, tenant.teacher.email).getByTestId('member-role')).toHaveText(
      ROLE_LABEL.teacher,
    );
    await expect(counter, 'search does not change the organization counter').toBeVisible();

    await search.fill(tenant.student.email.toUpperCase());
    await expect(memberRows(page)).toHaveCount(1);
    await expect(rowFor(page, tenant.student.email)).toHaveCount(1);
    await expect(counter).toBeVisible();

    await search.fill('');
    await expect(memberRows(page)).toHaveCount(members.length);

    // --- Step 3: "Filtruj po roli" ----------------------------------------
    const filter = page.getByRole('combobox', { name: COPY.roleFilter, exact: true });
    await expect(filter).toHaveText(COPY.allRoles);

    await filter.click();
    await expect(page.getByRole('option'), 'every role plus "all"').toHaveCount(roles.length + 1);
    for (const label of [COPY.allRoles, ...Object.values(ROLE_LABEL)]) {
      await expect(page.getByRole('option', { name: label, exact: true })).toHaveCount(1);
    }

    // Teacher: only the teacher's row survives.
    await page.getByRole('option', { name: ROLE_LABEL.teacher, exact: true }).click();
    await expect(filter).toHaveText(ROLE_LABEL.teacher);
    await expect(memberRows(page)).toHaveCount(1);
    await expect(rowFor(page, tenant.teacher.email)).toHaveCount(1);
    await expect(counter, 'the role filter does not change the counter').toBeVisible();

    // Member (displayed "Student"): the named student and the nameless member.
    await filter.click();
    await page.getByRole('option', { name: ROLE_LABEL.member, exact: true }).click();
    await expect(memberRows(page)).toHaveCount(2);
    await expect(rowFor(page, tenant.student.email)).toHaveCount(1);
    await expect(rowFor(page, tenant.unnamed.email)).toHaveCount(1);

    // All roles: back to the full list.
    await filter.click();
    await page.getByRole('option', { name: COPY.allRoles, exact: true }).click();
    await expect(memberRows(page)).toHaveCount(members.length);

    // --- Adjacent regression: search and filter combine with AND ----------
    // The role stays "Student" while the search names the teacher: no row matches.
    await filter.click();
    await page.getByRole('option', { name: ROLE_LABEL.member, exact: true }).click();
    await search.fill(tenant.teacher.email);
    await expect(memberRows(page), 'a teacher cannot match the Student filter').toHaveCount(0);

    // Clearing the search restores the filtered list (the filter did not reset).
    await search.fill('');
    await expect(memberRows(page)).toHaveCount(2);
    await expect(rowFor(page, tenant.student.email)).toHaveCount(1);

    await filter.click();
    await page.getByRole('option', { name: COPY.allRoles, exact: true }).click();
    await expect(memberRows(page)).toHaveCount(members.length);

    expect(pageErrors, 'uncaught page errors on the members page').toEqual([]);
  });
});
