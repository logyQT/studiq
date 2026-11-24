import { expect, test, type Page } from '@playwright/test';
import { json } from '#test/helpers/json';
import { loadTenant, loginAs, tenantUser, type QaTenant } from '#test/qa/fixtures/tenant';

/**
 * MGR-01 — the manager dashboard (`/manage`): member counters, quick actions and
 * the "Ostatni członkowie" list.
 *
 * Tenant (deterministic, shared `content` profile, fresh run suffix per run):
 *
 *   bun scripts/qa-tenant.ts MGR-01 --fresh
 *
 * gives the organization `qa-mgr-01-<hash>` with one account per account type
 * (`tenantKey('qa/cases/MGR-01.md', 'MGR-01#<suffix>', 'qa-shared')`) and real org
 * roles: the manager is `admin` (`entitlement_profile='all'`), the educator is
 * `teacher` (`all`) and the student is `member` (`learner`).
 *
 * Since phase 6b-2 the dashboard classifies by the role's **entitlement
 * profile**, not by `orgRoleName`: `learner` = Studenci, everyone else =
 * Wykładowcy (the admin included). With the seeded roles that is 3 / 2 / 1, and
 * no role promotion is needed any more. The second half of the first test pins
 * it: a **custom** role named something other than `member` with
 * `entitlement_profile='learner'` is assigned to the educator, and the counters
 * must move to 3 / 1 / 2 — a name-based classification cannot produce that.
 *
 * Walk: **the data contract was measured, the UI was not walked in the
 * implementer's worktree.** 2026-11-24 on base `999c45ab` + the uncommitted
 * change, against the served app on :3000 (whose build predates this branch):
 * a fresh `content` tenant was seeded for AUT-20 and its roster read as the
 * manager returned `admin`/`all`, `teacher`/`all`, `member`/`learner` with
 * `accountType` `manager`/`educator`/`student` — so the seeded counters are
 * 3 staff / 1 learner and the custom-role case moves one of them. The counters'
 * page logic was read from the code: `/manage` filters
 * `entitlementProfile === 'learner'` for Studenci. The coordinator runs the UI
 * walk on this branch's build and should replace this paragraph with the dated
 * record.
 *
 * Nothing global is read or written: no admin setting, feature flag, plan,
 * platform stat or singleton row. The custom role and the membership change live
 * in this tenant's own organization.
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
 * The seeded `content` tenant: admin (`all`) + educator (`all`) count as staff,
 * the student (`learner`) as a learner. The admin is counted in the total only,
 * never as a third learner.
 */
const SEEDED = { total: 3, staff: 2, learners: 1 } as const;

/** After the educator moves to a custom `learner` role: one staff, two learners. */
const AFTER_CUSTOM_LEARNER = { total: 3, staff: 1, learners: 2 } as const;

interface OrgMember {
  id: string;
  email: string;
  full_name: string | null;
  orgRoleName: string;
  entitlementProfile: 'all' | 'learner' | 'none';
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
  const body = await json<{ success: boolean; data: OrgMember[] }>(response);
  expect(body.success, 'members response').toBe(true);
  return body.data;
}

/**
 * Create a custom role whose *name* is not `member` and whose entitlement profile
 * is `learner`, then put the educator on it. This is the pin against a
 * name-based classification: the role row, not its label, says who is a student.
 */
async function moveEducatorToCustomLearnerRole(page: Page, tenant: QaTenant): Promise<string> {
  const educator = tenantUser(tenant, 'teacher');
  const roleName = `mgr01-learner-${Date.now().toString(36)}`;

  const created = await page.request.post('/api/v1/organization/roles', {
    data: { name: roleName, entitlementProfile: 'learner', template: 'blank' },
  });
  expect(created.status(), 'POST /api/v1/organization/roles').toBe(201);
  const createdBody = await json<{
    success: boolean;
    data: { id: string; name: string; entitlementProfile: string };
  }>(created);
  expect(createdBody.data).toMatchObject({ name: roleName, entitlementProfile: 'learner' });

  const member = (await listMembers(page)).find((candidate) => candidate.email === educator.email);
  expect(member, 'the seeded educator is an organization member').toBeTruthy();

  const update = await page.request.put('/api/v1/organization/members', {
    data: { targetUserId: member!.id, newOrgRoleId: createdBody.data.id },
  });
  expect(update.status(), 'PUT /api/v1/organization/members').toBe(200);

  const after = (await listMembers(page)).find((candidate) => candidate.email === educator.email);
  expect(after?.orgRoleName, 'the educator holds the custom role by name').toBe(roleName);
  expect(after?.entitlementProfile, 'and its learner profile is what travels').toBe('learner');

  return roleName;
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

test('counts members by role entitlement profile and links the quick actions and the recent list', async ({
  page,
}) => {
  const tenant = loadTenant(CASE);
  expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');

  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await signInAsManager(page, tenant);

  // --- Step 1: /manage ----------------------------------------------------
  await page.goto('/manage');
  await expect(page).toHaveURL(/\/manage$/, { timeout: 20_000 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

  // --- Step 2: the three counters, from the seeded role profiles ----------
  // The server state the cards mirror: 1 admin, 1 teacher, 1 student.
  const members = await listMembers(page);
  expect(members, 'organization members').toHaveLength(SEEDED.total);

  // The classification field itself is a read the UI does not hand this spec:
  // the roster carries each role's profile, so a dashboard that names the role
  // instead is visibly wrong.
  const profile = (email: string) =>
    members.find((member) => member.email === email)?.entitlementProfile;
  expect(profile(tenantUser(tenant, 'manager').email), 'the admin profile').toBe('all');
  expect(profile(tenantUser(tenant, 'teacher').email), 'the educator profile').toBe('all');
  expect(profile(tenantUser(tenant, 'student').email), 'the student profile').toBe('learner');

  const staff = members.filter((member) => member.entitlementProfile !== 'learner');
  const learners = members.filter((member) => member.entitlementProfile === 'learner');
  expect(staff, 'staff in the organization').toHaveLength(SEEDED.staff);
  expect(learners, 'learners in the organization').toHaveLength(SEEDED.learners);

  await expectStat(page, COPY.statTotal, SEEDED.total);
  await expectStat(page, COPY.statTeachers, SEEDED.staff);
  await expectStat(page, COPY.statStudents, SEEDED.learners);

  // --- Step 2b: a custom `learner` role is a student, whatever it is called -
  await moveEducatorToCustomLearnerRole(page, tenant);
  await page.reload();

  await expectStat(page, COPY.statTotal, AFTER_CUSTOM_LEARNER.total);
  await expectStat(page, COPY.statTeachers, AFTER_CUSTOM_LEARNER.staff);
  await expectStat(page, COPY.statStudents, AFTER_CUSTOM_LEARNER.learners);

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
  const current = await listMembers(page);
  const expectedRecent = [...current]
    .toSorted((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5);
  expect(expectedRecent.length, 'the tenant has at most five members').toBe(SEEDED.total);

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
  // never inflates the learner counter asserted above.
  const adminRow = rows.filter({ hasText: tenantUser(tenant, 'manager').email });
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
  await expect(recentRows(page)).toHaveCount(SEEDED.total);
  await expectStat(page, COPY.statTotal, SEEDED.total);

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
