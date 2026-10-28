import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { request as apiRequest, expect, test, type Page } from '@playwright/test';
import { tenantKey } from '#test/e2e/fixtures/ids';
import {
  buildAccount,
  createSeedDb,
  randomTag,
  seedTenantGraph,
  tenantId,
  type SeedAccount,
} from '#test/helpers/tenant-seed';

/**
 * MGR-03 — switching the active organization scopes the manager panel.
 *
 * Prerequisite (reconciled with the tenant seeder): the manager belongs to **two**
 * organizations, each with its own members, groups and pending invitation. That
 * replaces the legacy manual seed („M1”, WSB Merito vs UE Wrocław, O1G… vs O2G…);
 * the legacy `@dev.local` accounts and password `pass` are never used.
 *
 * Tenant: `tenantKey('qa/cases/MGR-03.md', 'MGR-03#<run>', 'qa-shared')`, plus a
 * per-run suffix (`QA_RUN_SUFFIX`, otherwise fresh). Every org/user/group id is
 * `tenantId(key, entity)`, so a run is reproducible by pinning the suffix and two
 * independent runs never share an organization.
 *
 * The spec seeds its own graph through the shared e2e helpers
 * (`__tests__/helpers/tenant-seed.ts`), because the profile the case needs — one
 * manager, two organizations, two invitations — is not in `qa/tests/profiles.json`.
 * Nothing global is written: no admin setting, feature flag, plan, platform stat or
 * another worker's tenant. All post-seed reads are read-only, so the three tests
 * can share one tenant.
 */

const CASE_FILE = 'qa/cases/MGR-03.md';
const PROJECT = 'qa-shared';
const RUN_SUFFIX =
  process.env.QA_RUN_SUFFIX ?? `r${Date.now().toString(36)}${randomTag(4)}`.toLowerCase();
/** Stable e-mail tag: the suffix is part of the address, so runs never collide. */
const RUN_TAG = RUN_SUFFIX.replace(/[^a-z0-9-]/gi, '-');

/** Supabase local defaults (the service-role JWT is the public `supabase start` demo key). */
const LOCAL_SUPABASE_URL = 'http://localhost:54421';
const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

/** Polish copy from `ManageOverviewPage`, `ManageMembersPage`, `ManageGroupsPage`, `ManageInvitationsPage`. */
const COPY = {
  totalMembers: 'Łączna liczba członków',
  teachers: 'Wykładowcy',
  students: 'Studenci',
  membersTitle: 'Członkowie',
  groupsTitle: 'Grupy',
  invitesTitle: 'Zaproszenia',
} as const;

interface CaseOrg {
  id: string;
  name: string;
  groups: string[];
  inviteEmail: string;
}

interface CaseTenant {
  key: string;
  manager: SeedAccount;
  /** „WSB Merito”: admin + teacher + student, two groups, one pending invite. */
  a: CaseOrg & { teacher: SeedAccount; student: SeedAccount };
  /** „UE Wrocław”: admin + student, one group, one pending invite. */
  b: CaseOrg & { student: SeedAccount };
}

interface OrgMembership {
  id: string;
  name: string;
  orgRoleName: string;
  isActive: boolean;
}

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

/**
 * Seed both organizations for one manager. `seedTenantGraph` is fed a distinct key
 * per org so the membership/group rows do not collide, while the manager account is
 * shared (same deterministic id) and is `admin` in both.
 */
async function seedCaseTenant(baseURL: string): Promise<CaseTenant> {
  const key = `${tenantKey(CASE_FILE, `MGR-03#${RUN_SUFFIX}`, PROJECT)}::${RUN_SUFFIX}`;
  const manager = buildAccount(key, 'manager', 'manager', { name: 'QA M1' });
  const teacher = buildAccount(key, 'teacher-a', 'educator', {
    name: 'QA T1',
    orgRole: 'teacher',
  });
  const studentA = buildAccount(key, 'student-a', 'student', { name: 'QA S1' });
  const studentB = buildAccount(key, 'student-b', 'student', { name: 'QA S2' });

  const a: CaseTenant['a'] = {
    id: tenantId(key, 'org:a'),
    name: `qa-mgr03-${RUN_TAG}-a`,
    groups: ['O1G1', 'O1G2'],
    inviteEmail: `qa-mgr03-a-${RUN_TAG}@test.local`,
    teacher,
    student: studentA,
  };
  const b: CaseTenant['b'] = {
    id: tenantId(key, 'org:b'),
    name: `qa-mgr03-${RUN_TAG}-b`,
    groups: ['O2G1'],
    inviteEmail: `qa-mgr03-b-${RUN_TAG}@test.local`,
    student: studentB,
  };

  const { url, serviceKey } = resolveSupabase();
  const db = createSeedDb({ url, serviceKey });

  const seededA = await seedTenantGraph(db, {
    key: `${key}:a`,
    org: { id: a.id, name: a.name },
    defaultGroup: { id: tenantId(key, 'group:a:O1G1'), name: a.groups[0], isDefault: true },
    extraGroups: [{ id: tenantId(key, 'group:a:O1G2'), name: a.groups[1], isDefault: false }],
    owner: manager,
    members: [teacher, studentA],
    ownerOrgRole: 'admin',
  });
  const seededB = await seedTenantGraph(db, {
    key: `${key}:b`,
    org: { id: b.id, name: b.name },
    defaultGroup: { id: tenantId(key, 'group:b:O2G1'), name: b.groups[0], isDefault: true },
    extraGroups: [],
    owner: manager,
    members: [studentB],
    ownerOrgRole: 'admin',
  });

  const memberRoleA = seededA.roleIds.member;
  const memberRoleB = seededB.roleIds.member;
  if (!memberRoleA || !memberRoleB) throw new Error(`seed ${key}: member role is missing`);

  // Mint one live invitation per org through the real MGR-INV-01 endpoint, so the
  // list scoping exercised by the case is production-shaped.
  const api = await apiRequest.newContext({ baseURL });
  try {
    const login = await api.post('/api/v1/auth/login', {
      data: { email: manager.email, password: manager.password },
    });
    expect(login.status(), `manager login (${manager.email})`).toBe(200);

    async function invite(org: CaseOrg, roleId: string): Promise<void> {
      const created = await api.post('/api/v1/organization/invites', {
        data: {
          email: org.inviteEmail,
          targetOrgRoleId: roleId,
          organizationId: org.id,
          locale: 'pl',
        },
      });
      expect(created.status(), `POST invites for ${org.name}`).toBe(201);
    }

    await invite(a, memberRoleA);
    await invite(b, memberRoleB);
  } finally {
    await api.dispose();
  }

  return { key, manager, a, b };
}

/** Real login through the API, so the session cookie lives in the page context. */
async function login(page: Page, account: SeedAccount): Promise<void> {
  const response = await page.request.post('/api/v1/auth/login', {
    data: { email: account.email, password: account.password },
  });
  expect(response.status(), `login ${account.email}`).toBe(200);
}

/** The active org is server state (the `active_org_id` cookie); pin it explicitly. */
async function pinActiveOrg(page: Page, orgId: string): Promise<void> {
  const response = await page.request.post('/api/v1/me/orgs/switch', {
    data: { orgId },
  });
  expect(response.status(), 'POST /api/v1/me/orgs/switch').toBe(200);
}

async function currentOrgs(page: Page): Promise<OrgMembership[]> {
  const response = await page.request.get('/api/v1/me/orgs');
  expect(response.status(), 'GET /api/v1/me/orgs').toBe(200);
  const body = (await response.json()) as { success: boolean; data: OrgMembership[] };
  expect(body.success).toBe(true);
  return body.data;
}

function orgSwitcher(page: Page) {
  return page.locator('[data-slot="sidebar-header"] [data-sidebar="menu-button"]').first();
}

/** The dashboard nests the sidebar-inset `<main>` around the page's own `<main>`. */
function content(page: Page) {
  return page.locator('main main');
}

/** The stat value is the sibling `<p>` of the card's title `<p>`. */
function statValue(page: Page, title: string) {
  return content(page).getByText(title, { exact: true }).locator('xpath=following-sibling::p[1]');
}

async function expectStats(
  page: Page,
  expected: { total: number; teachers: number; students: number },
): Promise<void> {
  await expect(statValue(page, COPY.totalMembers), 'total members').toHaveText(
    String(expected.total),
  );
  await expect(statValue(page, COPY.teachers), 'teachers').toHaveText(String(expected.teachers));
  await expect(statValue(page, COPY.students), 'students').toHaveText(String(expected.students));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Pick an organization in the top-bar switcher and wait for the switch to commit. */
async function switchOrg(page: Page, orgName: string): Promise<void> {
  const switcher = orgSwitcher(page);
  await switcher.click();
  const item = page.getByRole('menuitem', {
    name: new RegExp(escapeRegExp(orgName)),
  });
  await expect(item, `switcher entry for ${orgName}`).toBeVisible();

  const [response] = await Promise.all([
    page.waitForResponse(
      (res) => res.url().includes('/api/v1/me/orgs/switch') && res.request().method() === 'POST',
    ),
    item.click(),
  ]);
  expect(response.status(), `switch to ${orgName}`).toBe(200);

  // The trigger re-renders with the new active organization.
  await expect(switcher).toContainText(orgName);
}

/** Start every test from org A, whichever org the login auto-selected. */
async function signInAsManager(page: Page, tenant: CaseTenant): Promise<void> {
  await login(page, tenant.manager);
  await pinActiveOrg(page, tenant.a.id);
  await page.goto('/manage');
  await expect(page).toHaveURL(/\/manage$/);
  await expect(orgSwitcher(page)).toContainText(tenant.a.name);
}

test.describe('@case:MGR-03 @area:MGR @prio:P2 switching organization scopes the panel', () => {
  let tenant: CaseTenant;

  test.beforeAll(async () => {
    const baseURL = test.info().project.use.baseURL ?? 'http://localhost:3010';
    tenant = await seedCaseTenant(baseURL);
    console.log(`MGR-03 tenant key: ${tenant.key}`);
    console.log(`MGR-03 org A: ${tenant.a.id} (${tenant.a.name})`);
    console.log(`MGR-03 org B: ${tenant.b.id} (${tenant.b.name})`);
  });

  test.beforeEach(async ({ context, baseURL }) => {
    // The case quotes Polish copy; pin the locale instead of trusting a profile.
    const { hostname } = new URL(baseURL!);
    await context.addCookies([{ name: 'NEXT_LOCALE', value: 'pl', domain: hostname, path: '/' }]);
  });

  test('switching from the dashboard returns to /manage and rescopes the counters', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await signInAsManager(page, tenant);

    // Org A: two staff accounts and one student, as the tenant was seeded.
    await expect(orgSwitcher(page)).toContainText('Admin');
    await expectStats(page, { total: 3, teachers: 1, students: 1 });

    // Both memberships are real and the active one is marked by `isActive`; the
    // switcher menu itself is exercised by the switch below.
    const orgsBefore = await currentOrgs(page);
    expect(orgsBefore.map((org) => org.id).sort()).toEqual([tenant.a.id, tenant.b.id].sort());
    expect(orgsBefore.find((org) => org.id === tenant.a.id)?.isActive).toBe(true);
    expect(orgsBefore.every((org) => org.orgRoleName === 'admin')).toBe(true);

    // 1. Switch to org B from the dashboard: the app returns to /manage.
    await switchOrg(page, tenant.b.name);
    await expect(page).toHaveURL(/\/manage$/);
    await expectStats(page, { total: 2, teachers: 0, students: 1 });

    const orgsAfter = await currentOrgs(page);
    expect(orgsAfter.find((org) => org.id === tenant.b.id)?.isActive).toBe(true);
    expect(orgsAfter.find((org) => org.id === tenant.a.id)?.isActive).toBe(false);

    // 2. Switch back to org A: the original counters return, nothing is cached in.
    await switchOrg(page, tenant.a.name);
    await expect(page).toHaveURL(/\/manage$/);
    await expectStats(page, { total: 3, teachers: 1, students: 1 });

    const orgsBack = await currentOrgs(page);
    expect(orgsBack.find((org) => org.id === tenant.a.id)?.isActive).toBe(true);

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });

  test('members, groups and invitations only show the active organization', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await signInAsManager(page, tenant);
    const list = content(page);

    /** Org A on screen: its three members, both groups, its pending invitation. */
    await page.goto('/manage/members');
    await expect(page.getByRole('heading', { name: COPY.membersTitle, exact: true })).toBeVisible();
    await expect(list.locator('tbody tr')).toHaveCount(3);
    await expect(list.getByText(tenant.manager.email, { exact: true })).toBeVisible();
    await expect(list.getByText(tenant.a.teacher.email, { exact: true })).toBeVisible();
    await expect(list.getByText(tenant.a.student.email, { exact: true })).toBeVisible();
    await expect(list.getByText(tenant.b.student.email, { exact: true })).toHaveCount(0);

    await page.goto('/manage/groups');
    await expect(page.getByRole('heading', { name: COPY.groupsTitle, exact: true })).toBeVisible();
    for (const group of tenant.a.groups) {
      await expect(list.getByRole('cell', { name: group, exact: true })).toBeVisible();
    }
    await expect(list.getByRole('cell', { name: tenant.b.groups[0], exact: true })).toHaveCount(0);

    await page.goto('/manage/invites');
    await expect(page.getByRole('heading', { name: COPY.invitesTitle, exact: true })).toBeVisible();
    await expect(list.getByRole('cell', { name: tenant.a.inviteEmail, exact: true })).toBeVisible();
    await expect(list.getByRole('cell', { name: tenant.b.inviteEmail, exact: true })).toHaveCount(
      0,
    );

    // 1. Switch to org B from a sub-page: the app returns to /manage.
    await switchOrg(page, tenant.b.name);
    await expect(page).toHaveURL(/\/manage$/);

    // 2. Org B on screen: only its own two members, one group and invitation.
    await page.goto('/manage/members');
    await expect(list.locator('tbody tr')).toHaveCount(2);
    await expect(list.getByText(tenant.manager.email, { exact: true })).toBeVisible();
    await expect(list.getByText(tenant.b.student.email, { exact: true })).toBeVisible();
    await expect(list.getByText(tenant.a.teacher.email, { exact: true })).toHaveCount(0);
    await expect(list.getByText(tenant.a.student.email, { exact: true })).toHaveCount(0);

    await page.goto('/manage/groups');
    await expect(list.getByRole('cell', { name: tenant.b.groups[0], exact: true })).toBeVisible();
    for (const group of tenant.a.groups) {
      await expect(list.getByRole('cell', { name: group, exact: true })).toHaveCount(0);
    }

    await page.goto('/manage/invites');
    await expect(list.getByRole('cell', { name: tenant.b.inviteEmail, exact: true })).toBeVisible();
    await expect(list.getByRole('cell', { name: tenant.a.inviteEmail, exact: true })).toHaveCount(
      0,
    );

    // 3. Switch back to org A from a sub-page; its rows come back and B's disappear.
    await switchOrg(page, tenant.a.name);
    await expect(page).toHaveURL(/\/manage$/);

    await page.goto('/manage/members');
    await expect(list.locator('tbody tr')).toHaveCount(3);
    await expect(list.getByText(tenant.a.teacher.email, { exact: true })).toBeVisible();
    await expect(list.getByText(tenant.a.student.email, { exact: true })).toBeVisible();
    await expect(list.getByText(tenant.b.student.email, { exact: true })).toHaveCount(0);

    await page.goto('/manage/groups');
    for (const group of tenant.a.groups) {
      await expect(list.getByRole('cell', { name: group, exact: true })).toBeVisible();
    }
    await expect(list.getByRole('cell', { name: tenant.b.groups[0], exact: true })).toHaveCount(0);

    await page.goto('/manage/invites');
    await expect(list.getByRole('cell', { name: tenant.a.inviteEmail, exact: true })).toBeVisible();
    await expect(list.getByRole('cell', { name: tenant.b.inviteEmail, exact: true })).toHaveCount(
      0,
    );

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });

  test('the active organization survives a reload in both directions', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await signInAsManager(page, tenant);

    // Org A survives a hard reload.
    await page.reload();
    await expect(page).toHaveURL(/\/manage$/);
    await expect(orgSwitcher(page)).toContainText(tenant.a.name);
    await expectStats(page, { total: 3, teachers: 1, students: 1 });
    expect((await currentOrgs(page)).find((org) => org.isActive)?.id).toBe(tenant.a.id);

    // Org B survives a hard reload too — no fallback to the first membership.
    await switchOrg(page, tenant.b.name);
    await expect(page).toHaveURL(/\/manage$/);
    await page.reload();
    await expect(page).toHaveURL(/\/manage$/);
    await expect(orgSwitcher(page)).toContainText(tenant.b.name);
    await expectStats(page, { total: 2, teachers: 0, students: 1 });
    expect((await currentOrgs(page)).find((org) => org.isActive)?.id).toBe(tenant.b.id);

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });
});
