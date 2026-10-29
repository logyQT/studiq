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
  type SeedDb,
} from '#test/helpers/tenant-seed';

/**
 * SEC-04 — a manager of one organization cannot read or manage another
 * organization.
 *
 * Prerequisite (reconciled with the tenant seeder): a manager of one
 * organization while a **different** organization exists alongside it. The
 * legacy manual seed (`manager2@dev.local`, `student1@dev.local`, password
 * `pass`) is never used. The spec seeds two independent tenant graphs on every
 * run, under one run suffix, so no account, organization or membership is
 * shared with another case or another run:
 *
 * - org A (`qa-sec-04-a-<run>`) — only the attacker: a manager with the org
 *   `admin` role. This is the "Akademia Górnicza" side of the case: no other
 *   members, so any row that leaks in from elsewhere is obvious.
 * - org B (`qa-sec-04-b-<run>`) — its own manager (org `admin`) and S1, a
 *   student with the org `member` role. This is the "WSB Merito" side of the
 *   case; its student is the cross-organization target.
 *
 * The two organizations have deliberately different membership (1 vs 2), so a
 * list that leaked the other organization cannot coincide with the expected one.
 *
 * Acceptance points from the case:
 * 1. `GET /api/v1/organization/members` returns the attacker's own
 *    organization only — never the other organization's student.
 * 2. `PUT /api/v1/organization/members` aimed at the other organization's user
 *    is rejected (403/404) for every role id it could name, and the victim's
 *    membership row is unchanged afterwards.
 * 3. `GET /api/v1/organization/<other org id>` does not expose the other
 *    organization's data, while the attacker's own organization stays readable.
 *
 * Adjacent isolation paths that matter for this surface:
 * - a forged `active_org_id` cookie naming the other organization grants
 *   nothing (the server resolves the active org from real membership);
 * - `DELETE /api/v1/organization/members?userId=…` cannot remove the other
 *   organization's user;
 * - the isolation is symmetric: the other organization's manager cannot read
 *   org A either.
 *
 * Nothing global is written (no admin setting, feature flag, plan, platform
 * stat or singleton row) and no other case's tenant is touched.
 */

const CASE_FILE = 'qa/cases/SEC-04.md';
const TITLE = 'SEC-04 cross-organization isolation';
const PROJECT = 'qa-shared';
const RUN_SUFFIX = process.env.QA_RUN_SUFFIX ?? `${Date.now().toString(36)}-${randomTag(4)}`;
/** The tenant identity of this run; every id below is derived from it. */
const KEY = `${tenantKey(CASE_FILE, TITLE, PROJECT)}::${RUN_SUFFIX}`;
const KEY_A = `${KEY}::org-a`;
const KEY_B = `${KEY}::org-b`;

/** The organization's default group; the seeder enrolls every member in it. */
const GROUP_NAME = 'G1';

/** Polish copy from `ManageMembersPage`. */
const COPY = { title: 'Członkowie', membersSuffix: 'łącznie' } as const;

/** Supabase local defaults (the service-role JWT is the public `supabase start` demo key). */
const LOCAL_SUPABASE_URL = 'http://localhost:54421';
const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

interface CaseTenant {
  run: string;
  key: string;
  orgA: { id: string; name: string };
  orgB: { id: string; name: string };
  managerA: SeedAccount;
  managerB: SeedAccount;
  studentB: SeedAccount;
  /** Org role ids, so a request can name a role that belongs to the other org. */
  roleA: { admin: string };
  roleB: { admin: string; member: string };
}

interface Member {
  id: string;
  email: string;
  full_name: string | null;
  orgRoleName: string;
  orgRoleId: string;
  organization_id: string;
}

interface ApiBody<T> {
  success: boolean;
  data?: T;
  error?: string;
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
 * Two organizations that share nothing: the attacker's org A has a single
 * admin; org B has its own admin and the student whose user id is the target of
 * the cross-organization attempts.
 */
async function seedCaseTenant(db: SeedDb): Promise<CaseTenant> {
  const orgA = { id: tenantId(KEY_A, 'org'), name: `qa-sec-04-a-${RUN_SUFFIX}` };
  const orgB = { id: tenantId(KEY_B, 'org'), name: `qa-sec-04-b-${RUN_SUFFIX}` };

  const managerA = buildAccount(KEY_A, 'manager', 'manager', {
    email: accountEmail('manager-a'),
    name: 'QA SEC-04 manager A',
  });
  const managerB = buildAccount(KEY_B, 'manager', 'manager', {
    email: accountEmail('manager-b'),
    name: 'QA SEC-04 manager B',
  });
  const studentB = buildAccount(KEY_B, 'student', 'student', {
    email: accountEmail('student-b'),
    name: 'QA SEC-04 student B',
  });

  const seededA = await seedTenantGraph(db, {
    key: KEY_A,
    org: orgA,
    defaultGroup: { id: tenantId(KEY_A, 'group:default'), name: GROUP_NAME, isDefault: true },
    extraGroups: [],
    owner: managerA,
    members: [],
    ownerOrgRole: 'admin',
  });
  const seededB = await seedTenantGraph(db, {
    key: KEY_B,
    org: orgB,
    defaultGroup: { id: tenantId(KEY_B, 'group:default'), name: GROUP_NAME, isDefault: true },
    extraGroups: [],
    owner: managerB,
    members: [studentB],
    ownerOrgRole: 'admin',
  });

  return {
    run: RUN_SUFFIX,
    key: KEY,
    orgA,
    orgB,
    managerA: seededA.owner,
    managerB: seededB.owner,
    studentB: seededB.members[0]!,
    roleA: { admin: seededA.roleIds.admin! },
    roleB: { admin: seededB.roleIds.admin!, member: seededB.roleIds.member! },
  };
}

/**
 * Real login through the API, then boot the app with the locale the case's copy
 * is written in and the given organization active (the cookie the app writes
 * when an organization is created or switched). Logs any previous user out
 * first, so the run never inherits a session from another worker.
 */
async function signInAs(
  page: Page,
  baseURL: string,
  account: SeedAccount,
  activeOrgId: string,
): Promise<void> {
  await page.request.post('/api/v1/auth/logout');

  const response = await page.request.post('/api/v1/auth/login', {
    data: { email: account.email, password: account.password },
  });
  expect(response.status(), `login ${account.email}`).toBe(200);

  const { hostname } = new URL(baseURL);
  await page.context().addCookies([
    { name: 'NEXT_LOCALE', value: 'pl', domain: hostname, path: '/' },
    { name: 'active_org_id', value: activeOrgId, domain: hostname, path: '/', httpOnly: true },
  ]);

  await page.goto('/manage');
  await expect(page).toHaveURL(/\/manage$/, { timeout: 20_000 });
}

async function listMembers(page: Page): Promise<Member[]> {
  const response = await page.request.get('/api/v1/organization/members');
  expect(response.status(), 'GET /api/v1/organization/members').toBe(200);
  const body = (await response.json()) as ApiBody<Member[]>;
  expect(body.success).toBe(true);
  return body.data ?? [];
}

/** A cross-organization role change: the raw status and the app error code. */
async function attemptRoleChange(
  page: Page,
  targetUserId: string,
  newOrgRoleId: string,
): Promise<{ status: number; error?: string }> {
  const response = await page.request.put('/api/v1/organization/members', {
    data: { targetUserId, newOrgRoleId },
  });
  const body = (await response.json()) as ApiBody<unknown>;
  return { status: response.status(), error: body.error };
}

/**
 * The case accepts 403 or 404 for a rejected cross-organization write. The
 * status and the error code must agree, so a 403 cannot masquerade as a
 * validation error.
 */
function expectRejected(result: { status: number; error?: string }, label: string): void {
  expect([403, 404], `${label}: rejected with 403/404`).toContain(result.status);
  expect(result.error, `${label}: error code matches the status`).toBe(
    result.status === 403 ? 'FORBIDDEN' : 'NOT_FOUND',
  );
}

test.describe('@case:SEC-04 @area:SEC @prio:P1 cross-organization isolation', () => {
  let tenant: CaseTenant;
  let db: SeedDb;

  test.beforeAll(async () => {
    db = createSeedDb(resolveSupabase());
    tenant = await seedCaseTenant(db);
    // Evidence for a failing run: the deterministic tenant this run owns.
    console.log(
      `SEC-04 tenant key: ${tenant.key} (org A ${tenant.orgA.id} / ${tenant.orgA.name}, ` +
        `org B ${tenant.orgB.id} / ${tenant.orgB.name}, manager A ${tenant.managerA.email})`,
    );
  });

  test('a manager cannot read or modify another organization', async ({ page, baseURL }) => {
    test.setTimeout(120_000);

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const origin = baseURL ?? 'http://localhost:3010';
    const { orgA, orgB, managerA, managerB, studentB } = tenant;

    // Start as org A's manager with org A active.
    await signInAs(page, origin, managerA, orgA.id);

    // --- Step 1: GET /api/v1/organization/members -------------------------
    const members = await listMembers(page);
    expect(members, 'org A has exactly one member, its admin').toHaveLength(1);
    expect(members[0]).toMatchObject({
      id: managerA.id,
      email: managerA.email,
      orgRoleName: 'admin',
      organization_id: orgA.id,
    });
    // The other organization's student appears under no shape: id, e-mail, name.
    expect(
      members.some((member) => member.id === studentB.id),
      'the other organization’s user must not be listed',
    ).toBe(false);
    expect(members.map((member) => member.email)).not.toContain(studentB.email);
    expect(members.map((member) => member.full_name)).not.toContain(studentB.name);

    // The same list as the manager sees it: one row, the organization counter
    // matches, and the other organization's student is nowhere on the page.
    await page.goto('/manage/members');
    await expect(page).toHaveURL(/\/manage\/members$/, { timeout: 20_000 });
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
    await expect(
      page.getByRole('heading', { level: 2, name: COPY.title, exact: true }),
    ).toBeVisible();
    const membersTable = page.getByRole('table');
    await expect(membersTable.getByText(managerA.email, { exact: true })).toBeVisible();
    await expect(membersTable).toContainText(managerA.name!);
    await expect(page.getByText(`1 ${COPY.membersSuffix}`, { exact: true })).toBeVisible();
    await expect(page.getByText(studentB.email)).toHaveCount(0);
    await expect(page.getByText(studentB.name!, { exact: true })).toHaveCount(0);
    await expect(page.getByText(orgB.name, { exact: true })).toHaveCount(0);

    // --- Step 2: PUT /api/v1/organization/members -------------------------
    // (a) The other organization's user named with a role id from the
    //     attacker's own organization: the target is not a member here.
    expectRejected(
      await attemptRoleChange(page, studentB.id, tenant.roleA.admin),
      'foreign user + own org role',
    );
    // (b) The other organization's user named with the other organization's own
    //     admin role id: the role is not one of this organization.
    expectRejected(
      await attemptRoleChange(page, studentB.id, tenant.roleB.admin),
      'foreign user + foreign org role',
    );
    // (c) The other organization's user with an unknown role id: still no write.
    expectRejected(
      await attemptRoleChange(page, studentB.id, '00000000-0000-4000-8000-000000000000'),
      'foreign user + unknown role',
    );

    // Adjacent write path: removal cannot cross organizations either.
    const removal = await page.request.delete(`/api/v1/organization/members?userId=${studentB.id}`);
    expect([403, 404], 'cross-organization delete is rejected').toContain(removal.status());
    const removalBody = (await removal.json()) as ApiBody<unknown>;
    expect(removalBody.success).toBe(false);
    expect(removalBody.error).toBe(removal.status() === 403 ? 'FORBIDDEN' : 'NOT_FOUND');

    // --- Step 3: GET /api/v1/organization/<id> ----------------------------
    const foreignOrg = await page.request.get(`/api/v1/organization/${orgB.id}`);
    expect([403, 404], 'the other organization is not readable').toContain(foreignOrg.status());
    const foreignBody = (await foreignOrg.text()) as string;
    expect(foreignBody, 'the response must not disclose the other organization').not.toContain(
      orgB.name,
    );

    // Control: the same endpoint does answer for the attacker's own organization,
    // so the rejection above is about the id and not a broken route.
    const ownOrg = await page.request.get(`/api/v1/organization/${orgA.id}`);
    expect(ownOrg.status(), 'own organization stays readable').toBe(200);
    const ownBody = (await ownOrg.json()) as ApiBody<{ id: string; name: string }>;
    expect(ownBody.data).toMatchObject({ id: orgA.id, name: orgA.name });

    // --- Adjacent: a forged active-org cookie grants nothing --------------
    // `withAuth` derives the active organization from a real membership row, so
    // simply naming the other organization in the cookie cannot open it.
    const { hostname } = new URL(origin);
    await page
      .context()
      .addCookies([
        { name: 'active_org_id', value: orgB.id, domain: hostname, path: '/', httpOnly: true },
      ]);
    const forgedList = await page.request.get('/api/v1/organization/members');
    expect(forgedList.status(), 'forged cookie: members list denied').toBe(403);
    const forgedOrg = await page.request.get(`/api/v1/organization/${orgB.id}`);
    expect(forgedOrg.status(), 'forged cookie: foreign org denied').toBe(403);
    await page
      .context()
      .addCookies([
        { name: 'active_org_id', value: orgA.id, domain: hostname, path: '/', httpOnly: true },
      ]);
    await page.goto('/manage/members');
    await expect(page).toHaveURL(/\/manage\/members$/, { timeout: 20_000 });
    expect((await listMembers(page)).map((member) => member.id)).toEqual([managerA.id]);

    // --- The rejected attempts left no trace in the database --------------
    const victimMemberships = await db
      .from('org_members')
      .select('organization_id, org_role_id')
      .eq('user_id', studentB.id);
    expect(victimMemberships.error).toBeNull();
    expect(victimMemberships.data, 'the victim keeps exactly one membership').toHaveLength(1);
    expect(victimMemberships.data![0]).toMatchObject({
      organization_id: orgB.id,
      org_role_id: tenant.roleB.member,
    });

    const attackerMemberships = await db
      .from('org_members')
      .select('organization_id, org_role_id')
      .eq('user_id', managerA.id);
    expect(attackerMemberships.error).toBeNull();
    expect(attackerMemberships.data, 'the attacker gained no second membership').toHaveLength(1);
    expect(attackerMemberships.data![0]).toMatchObject({
      organization_id: orgA.id,
      org_role_id: tenant.roleA.admin,
    });

    // --- The victim's own manager still sees an untouched organization ----
    await signInAs(page, origin, managerB, orgB.id);
    const victimMembers = await listMembers(page);
    expect(victimMembers.map((member) => member.id).sort()).toEqual(
      [managerB.id, studentB.id].sort(),
    );
    expect(victimMembers.find((member) => member.id === studentB.id)?.orgRoleName).toBe('member');

    // Symmetry: org B's manager gets the same rejection for org A.
    const oppositeOrg = await page.request.get(`/api/v1/organization/${orgA.id}`);
    expect([403, 404], 'the isolation is symmetric').toContain(oppositeOrg.status());
    const oppositeBody = await oppositeOrg.text();
    expect(oppositeBody).not.toContain(orgA.name);
    expectRejected(
      await attemptRoleChange(page, managerA.id, tenant.roleB.admin),
      'reverse direction: foreign user + own org role',
    );

    expect(pageErrors, 'uncaught page errors during the walk').toEqual([]);
  });
});
