import { expect, test, type Page } from '@playwright/test';
import { createQaSupabase } from '@qa/fixtures/qa-db';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * SEC-04 — a manager of one organization cannot read or manage another
 * organization.
 *
 * Prerequisite (reconciled with the tenant seeder): a manager of one
 * organization while a **different** organization exists alongside it. The
 * legacy manual accounts (`manager2`, `student1`, password `pass`) are never
 * used. `__tests__/qa/profiles/SEC-04.json` declares two
 * organizations with two different owners, seeded once before Playwright starts:
 *
 *   bun scripts/qa-tenant.ts SEC-04 --fresh
 *
 * - org A (`orgs[0]`, key `a`) — only `managerA`, a manager with the org
 *   `admin` role. This is the "Akademia Górnicza" side of the case: no other
 *   members, so any row that leaks in from elsewhere is obvious.
 * - org B (`orgs[1]`, key `org2`) — its own `managerB` (org `admin`) and
 *   `studentB`, a student with the org `member` role. This is the "WSB Merito"
 *   side of the case; its student is the cross-organization target.
 *
 * Each organization has its own owner, so the two admins share no membership.
 * The two organizations have deliberately different membership (1 vs 2), so a
 * list that leaked the other organization cannot coincide with the expected one.
 * The spec only reads `loadTenant('SEC-04')` and signs the seeded accounts in
 * with `loginAs`; it never creates an account, organization or membership.
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

const CASE = 'SEC-04';
const TENANT = loadTenant(CASE) as CaseTenant;

/** Polish copy from `ManageMembersPage`. */
const COPY = { title: 'Członkowie', membersSuffix: 'łącznie' } as const;

interface TenantUser {
  id: string;
  email: string;
  password: string;
}

interface TenantOrg {
  key: string;
  id: string;
  name: string;
  groupId: string;
  groupName: string;
}

/** Shape `scripts/qa-tenant.ts` writes for the profile's `orgs` declaration. */
interface CaseTenant extends QaTenant {
  orgs: [TenantOrg, TenantOrg];
  users: {
    managerA: TenantUser;
    managerB: TenantUser;
    studentB: TenantUser;
  };
}

interface Member {
  id: string;
  email: string;
  full_name: string | null;
  orgRoleName: string;
  orgRoleId: string;
  organization_id: string;
}

interface OrgRole {
  id: string;
  name: string;
  isSystem: boolean;
}

interface ApiBody<T> {
  success: boolean;
  data?: T;
  error?: string;
}

async function getData<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path);
  expect(response.status(), `GET ${path}`).toBe(200);
  const body = (await response.json()) as ApiBody<T>;
  expect(body.success, `GET ${path} success`).toBe(true);
  return body.data as T;
}

/**
 * A fresh session for one of the two seeded owners, with that organization
 * active (the cookie the app writes when an organization is created or
 * switched). Clearing cookies first means one login never inherits the other
 * organization's context.
 */
async function switchUser(
  page: Page,
  role: 'managerA' | 'managerB',
  activeOrgId: string,
): Promise<void> {
  await page.context().clearCookies();
  await loginAs(page, TENANT, role, {
    locale: 'pl',
    activeOrgId,
    waitFor: /\/manage$/,
  });
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
}

/** The active organization's own system-role ids, read through the product API. */
async function orgRoleIds(page: Page): Promise<Record<'admin' | 'teacher' | 'member', string>> {
  const roles = await getData<OrgRole[]>(page, '/api/v1/organization/roles');
  const roleId = (name: 'admin' | 'teacher' | 'member'): string => {
    const role = roles.find((row) => row.name === name && row.isSystem);
    expect(role, `the organization has its system ${name} role`).toBeTruthy();
    return role!.id;
  };
  return { admin: roleId('admin'), teacher: roleId('teacher'), member: roleId('member') };
}

async function listMembers(page: Page): Promise<Member[]> {
  return getData<Member[]>(page, '/api/v1/organization/members');
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
  test('a manager cannot read or modify another organization', async ({ page }) => {
    test.setTimeout(120_000);

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const [orgA, orgB] = TENANT.orgs;
    const { managerA, managerB, studentB } = TENANT.users;
    // Read-only service client for the post-condition check; every write in this
    // test goes through the product API.
    const db = createQaSupabase();

    // Evidence for a failing run: the deterministic tenant this run owns.
    console.log(
      `SEC-04 tenant key: ${TENANT.key} (org A ${orgA.id} / ${orgA.name}, ` +
        `org B ${orgB.id} / ${orgB.name}, manager A ${managerA.email})`,
    );

    // Role rows belong to one organization, so each set is resolved from its own
    // admin session: an id from org A is not a role of org B and vice versa.
    await switchUser(page, 'managerA', orgA.id);
    const roleA = await orgRoleIds(page);
    await switchUser(page, 'managerB', orgB.id);
    const roleB = await orgRoleIds(page);
    const victimView = await listMembers(page);
    const studentBMember = victimView.find((member) => member.id === studentB.id);
    expect(studentBMember, 'the org-B student is a member of org B').toBeTruthy();
    const studentBName = studentBMember!.full_name;
    expect(studentBName, 'the seeded student has a display name').toBeTruthy();

    // Start as org A's manager with org A active.
    await switchUser(page, 'managerA', orgA.id);

    // --- Step 1: GET /api/v1/organization/members -------------------------
    const members = await listMembers(page);
    expect(members, 'org A has exactly one member, its admin').toHaveLength(1);
    expect(members[0]).toMatchObject({
      id: managerA.id,
      email: managerA.email,
      orgRoleName: 'admin',
      organization_id: orgA.id,
    });
    const managerAName = members[0]!.full_name;
    expect(managerAName, 'the seeded manager has a display name').toBeTruthy();
    // The other organization's student appears under no shape: id, e-mail, name.
    expect(
      members.some((member) => member.id === studentB.id),
      'the other organization’s user must not be listed',
    ).toBe(false);
    expect(members.map((member) => member.email)).not.toContain(studentB.email);
    expect(members.map((member) => member.full_name)).not.toContain(studentBName);

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
    await expect(membersTable).toContainText(managerAName!);
    await expect(page.getByText(`1 ${COPY.membersSuffix}`, { exact: true })).toBeVisible();
    await expect(page.getByText(studentB.email)).toHaveCount(0);
    await expect(page.getByText(studentBName!, { exact: true })).toHaveCount(0);
    await expect(page.getByText(orgB.name, { exact: true })).toHaveCount(0);

    // --- Step 2: PUT /api/v1/organization/members -------------------------
    // (a) The other organization's user named with a role id from the
    //     attacker's own organization: the target is not a member here.
    expectRejected(
      await attemptRoleChange(page, studentB.id, roleA.admin),
      'foreign user + own org role',
    );
    // (b) The other organization's user named with the other organization's own
    //     admin role id: the role is not one of this organization.
    expectRejected(
      await attemptRoleChange(page, studentB.id, roleB.admin),
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
    const { hostname } = new URL(page.url());
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
      org_role_id: roleB.member,
    });

    const attackerMemberships = await db
      .from('org_members')
      .select('organization_id, org_role_id')
      .eq('user_id', managerA.id);
    expect(attackerMemberships.error).toBeNull();
    expect(attackerMemberships.data, 'the attacker gained no second membership').toHaveLength(1);
    expect(attackerMemberships.data![0]).toMatchObject({
      organization_id: orgA.id,
      org_role_id: roleA.admin,
    });

    // --- The victim's own manager still sees an untouched organization ----
    await switchUser(page, 'managerB', orgB.id);
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
      await attemptRoleChange(page, managerA.id, roleB.admin),
      'reverse direction: foreign user + own org role',
    );

    expect(pageErrors, 'uncaught page errors during the walk').toEqual([]);
  });
});
