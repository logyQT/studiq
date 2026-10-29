import { expect, test, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * MGR-01 — the manager dashboard (`/manage`): member counters, quick actions and
 * the "Ostatni członkowie" list.
 *
 * Tenant (deterministic, shared `content` profile, fresh run suffix per run):
 *
 *   bun scripts/qa-tenant.ts MGR-01 --fresh
 *
 * gives the organization `qa-mgr-01-<hash>` with one account per account type
 * (`tenantKey('qa/cases/MGR-01.md', 'MGR-01#<suffix>', 'qa-shared')`). The seeder
 * enrolls every member with the system `member` role, so the educator is an org
 * *student* until a manager promotes it. The case's dataset is a manager, an
 * educator and a student, and the dashboard counts Wykładowcy/Studenci by the
 * member's org role — so each test promotes the seeded educator to the org
 * `teacher` role through the same `PUT /api/v1/organization/members` the
 * `/manage/members` page calls. That write is tenant-local and idempotent; it is
 * the only reason the counters are 3 / 1 / 1 instead of 3 / 0 / 2.
 *
 * Nothing global is read or written: no admin setting, feature flag, plan,
 * platform stat or singleton row.
 */

const CASE = 'MGR-01';
const APP_URL = process.env.QA_APP_URL ?? 'http://localhost:3010';
const HOST = new URL(APP_URL).hostname;

/** Polish copy from `ManageOverviewPage`, `ManageInvitationsPage`, `ManageMembersPage`. */
const COPY = {
  statTotal: 'Łączna liczba członków',
  statTeachers: 'Wykładowcy',
  statStudents: 'Studenci',
  quickActions: 'Szybkie akcje',
  invite: 'Zaproś członków',
  manage: 'Zarządzaj członkami',
  recent: 'Ostatni członkowie',
  loading: 'Ładowanie...',
  empty: 'Brak członków',
  invitesTitle: 'Zaproszenia',
  membersTitle: 'Członkowie',
} as const;

/**
 * The seeded tenant graph is one admin + one educator + one student. With the
 * educator on the org `teacher` role the dashboard must show 3 total, 1 teacher
 * and 1 student: the admin is counted in the total only.
 */
const EXPECTED = { total: 3, teachers: 1, students: 1 } as const;

interface OrgMember {
  id: string;
  email: string;
  full_name: string | null;
  orgRoleName: string;
  orgRoleId: string;
  created_at: string;
}

/** The stat value is the sibling `<p>` of the card's title `<p>`. */
function statValue(page: Page, title: string) {
  return page.getByText(title, { exact: true }).locator('xpath=following-sibling::p[1]');
}

async function expectStat(page: Page, title: string, value: number): Promise<void> {
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  await expect(statValue(page, title), `stat "${title}"`).toHaveText(String(value));
}

function recentCard(page: Page) {
  return page.locator('[data-slot="card"]').filter({ hasText: COPY.recent });
}

function recentRows(page: Page) {
  // Each member is one `flex` row inside the card's `space-y-3` list.
  return recentCard(page).locator('[data-slot="card-content"] > div > div');
}

async function listMembers(page: Page): Promise<OrgMember[]> {
  const response = await page.request.get('/api/v1/organization/members');
  expect(response.status(), 'GET /api/v1/organization/members').toBe(200);
  const body = (await response.json()) as { success: boolean; data: OrgMember[] };
  expect(body.success, 'members response').toBe(true);
  return body.data;
}

/**
 * Make the educator's org role match the tenant's intent: the seeded `content`
 * profile enrolls everyone as `member`, and the dashboard counts Wykładowcy by
 * the `teacher` org role. Runs before any route stub, and is a no-op on a tenant
 * that is already in shape.
 */
async function ensureEducatorIsTeacher(page: Page, tenant: QaTenant): Promise<void> {
  const educator = tenant.users.teacher;
  if (!educator) throw new Error(`${CASE} needs the content tenant profile (teacher account)`);

  const members = await listMembers(page);
  const member = members.find((candidate) => candidate.email === educator.email);
  expect(member, 'the seeded educator is an organization member').toBeTruthy();
  if (member!.orgRoleName === 'teacher') return;

  const rolesResponse = await page.request.get('/api/v1/organization/roles');
  expect(rolesResponse.status(), 'GET /api/v1/organization/roles').toBe(200);
  const rolesBody = (await rolesResponse.json()) as {
    success: boolean;
    data: Array<{ id: string; name: string }>;
  };
  const teacherRole = rolesBody.data.find((role) => role.name === 'teacher');
  expect(teacherRole, 'the organization has the system teacher role').toBeTruthy();

  const update = await page.request.put('/api/v1/organization/members', {
    data: { targetUserId: member!.id, newOrgRoleId: teacherRole!.id },
  });
  expect(update.status(), 'PUT /api/v1/organization/members').toBe(200);

  const after = await listMembers(page);
  expect(
    after.find((candidate) => candidate.email === educator.email)?.orgRoleName,
    'the educator now holds the org teacher role',
  ).toBe('teacher');
}

/** Sign in as the tenant manager with this case's organization active. */
async function signInAsManager(page: Page, tenant: QaTenant): Promise<void> {
  const orgId = tenant.org?.id;
  if (!orgId) throw new Error(`${CASE} needs the content tenant profile (org + manager)`);

  await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage(\/|$)/ });
  // Org-scoped endpoints resolve the organization from this cookie; pin it to
  // the tenant's own org so an earlier case's active org cannot leak in.
  await page
    .context()
    .addCookies([{ name: 'active_org_id', value: orgId, domain: HOST, path: '/', httpOnly: true }]);
}

test('counts members by org role and links the quick actions and the recent list', async ({
  page,
}) => {
  const tenant = loadTenant(CASE);
  expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');

  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await signInAsManager(page, tenant);
  await ensureEducatorIsTeacher(page, tenant);

  // --- Step 1: /manage ----------------------------------------------------
  await page.goto('/manage');
  await expect(page).toHaveURL(/\/manage$/, { timeout: 20_000 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

  // --- Step 2: the three counters ----------------------------------------
  // The server state the cards must mirror: 1 admin, 1 teacher, 1 student.
  const members = await listMembers(page);
  expect(members, 'organization members').toHaveLength(EXPECTED.total);
  expect(
    members.filter((member) => member.orgRoleName === 'teacher'),
    'teachers in the organization',
  ).toHaveLength(EXPECTED.teachers);
  expect(
    members.filter((member) => member.orgRoleName === 'member'),
    'students in the organization',
  ).toHaveLength(EXPECTED.students);

  await expectStat(page, COPY.statTotal, EXPECTED.total);
  await expectStat(page, COPY.statTeachers, EXPECTED.teachers);
  await expectStat(page, COPY.statStudents, EXPECTED.students);

  // --- Step 3: quick actions reach the real screens ----------------------
  const quickActions = page.locator('[data-slot="card"]').filter({ hasText: COPY.quickActions });
  await expect(quickActions.getByText(COPY.quickActions, { exact: true })).toBeVisible();

  const inviteLink = quickActions.getByRole('link', { name: COPY.invite, exact: true });
  const manageLink = quickActions.getByRole('link', { name: COPY.manage, exact: true });
  await expect(inviteLink).toHaveAttribute('href', '/manage/invites');
  await expect(manageLink).toHaveAttribute('href', '/manage/members');

  await inviteLink.click();
  await expect(page).toHaveURL(/\/manage\/invites$/, { timeout: 20_000 });
  await expect(page.getByRole('heading', { level: 2, name: COPY.invitesTitle })).toBeVisible();

  await page.goto('/manage');
  await expect(manageLink).toBeVisible();
  await manageLink.click();
  await expect(page).toHaveURL(/\/manage\/members$/, { timeout: 20_000 });
  await expect(page.getByRole('heading', { level: 2, name: COPY.membersTitle })).toBeVisible();

  // --- Step 4: "Ostatni członkowie" reflects the organization ------------
  await page.goto('/manage');
  await expect(page.getByText(COPY.recent, { exact: true })).toBeVisible();

  // Same comparator the card uses (newest profile first, at most five rows), so
  // the expectation is derived from the tenant's own members, not a fixture list.
  const expectedRecent = [...members]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5);
  expect(expectedRecent.length, 'the tenant has at most five members').toBe(EXPECTED.total);

  const rows = recentRows(page);
  await expect(rows).toHaveCount(expectedRecent.length);

  for (const [index, member] of expectedRecent.entries()) {
    const row = rows.nth(index);
    const name = member.full_name ?? member.email;
    await expect(row.locator('p').first(), `row ${index} name`).toHaveText(name);
    if (member.full_name) {
      await expect(row.locator('p').nth(1), `row ${index} email`).toHaveText(member.email);
    }
    await expect(row.locator('span'), `row ${index} org role`).toHaveText(member.orgRoleName);
  }

  // The admin appears in the list (and in the total) with the admin role, but
  // never inflates the teacher/student counters asserted above.
  const adminRow = rows.filter({ hasText: tenant.users.manager!.email });
  await expect(adminRow).toHaveCount(1);
  await expect(adminRow.locator('span')).toHaveText('admin');

  expect(pageErrors, 'uncaught page errors').toEqual([]);
});

test('renders the loading placeholder and the empty "Brak członków" state without errors', async ({
  page,
}) => {
  const tenant = loadTenant(CASE);
  expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');

  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await signInAsManager(page, tenant);
  await ensureEducatorIsTeacher(page, tenant);

  // --- Loading state: hold the members request open ----------------------
  const membersRoute = '**/api/v1/organization/members';
  let releaseMembers!: () => void;
  const held = new Promise<void>((resolve) => {
    releaseMembers = resolve;
  });
  await page.route(membersRoute, async (route) => {
    await held;
    await route.continue();
  });

  await page.reload();

  const recent = recentCard(page);
  await expect(recent.getByText(COPY.loading, { exact: true })).toBeVisible();
  // Loading is a placeholder, never "Brak członków" and never a stale number.
  await expect(recent.getByText(COPY.empty, { exact: true })).toHaveCount(0);
  await expect(recentRows(page)).toHaveCount(0);
  await expect(page.getByText(COPY.statTotal, { exact: true })).toBeVisible();
  await expect(statValue(page, COPY.statTotal)).toHaveCount(0);

  releaseMembers();
  await expect(recent.getByText(COPY.loading, { exact: true })).toHaveCount(0);
  await expect(recentRows(page)).toHaveCount(EXPECTED.total);
  await expectStat(page, COPY.statTotal, EXPECTED.total);

  // --- Empty state: an organization with no members at all --------------
  // An org with zero members cannot be produced through the product (the
  // manager's own membership is the seat), so the members endpoint is stubbed
  // for this page load. Nothing is written; the tenant stays untouched.
  await page.unroute(membersRoute);
  await page.route(membersRoute, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [] }),
    }),
  );

  await page.reload();

  await expect(recent.getByText(COPY.empty, { exact: true })).toBeVisible();
  await expect(recent.getByText(COPY.loading, { exact: true })).toHaveCount(0);
  await expect(recentRows(page)).toHaveCount(0);
  await expectStat(page, COPY.statTotal, 0);
  await expectStat(page, COPY.statTeachers, 0);
  await expectStat(page, COPY.statStudents, 0);

  expect(pageErrors, 'uncaught page errors').toEqual([]);
});
