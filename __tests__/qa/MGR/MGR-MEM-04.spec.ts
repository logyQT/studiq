import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * MGR-MEM-04 — removing a member from the organization (/manage/members).
 *
 * Prerequisite (case text: „Dodatkowy członek testowy”): the `content` tenant
 * profile — an organization with a manager (admin), a teacher and a student, all
 * enrolled in the default group `G1`:
 *
 *   bun scripts/qa-tenant.ts MGR-MEM-04 --fresh
 *
 * Removal is destructive, so every independent run must seed a fresh tenant
 * first: that command overwrites `qa/.tenants/MGR-MEM-04.json` with a new run
 * suffix, and the spec reads every id from the file. Nothing global is read or
 * written — no admin setting, feature flag, plan, platform stat or singleton row
 * — and no other case's tenant is touched.
 *
 * Acceptance criteria (case text):
 * - confirming the „Usunąć z organizacji?” dialog removes the member and shows
 *   the toast „Członek usunięty z organizacji”;
 * - after a refresh the member is gone from the list;
 * - the removed user loses access to the organization's data.
 *
 * The case adds a note: right after the action the interface may leave the row
 * on screen with the `member` role. The product does keep it until the page is
 * reloaded (the list is patched locally instead of re-fetched), which the case
 * explicitly marks as „zanotuj” — an observation, not an expectation. This spec
 * therefore asserts the intended end state (toast + row gone after a refresh),
 * never the stale row.
 *
 * Adjacent paths that protect the same destructive surface: cancelling the
 * dialog must delete nothing, and the manager's own row must neither offer nor
 * accept removal.
 */

const CASE = 'MGR-MEM-04';
const APP_URL = process.env.QA_APP_URL ?? 'http://localhost:3010';
const HOST = new URL(APP_URL).hostname;
const MEMBERS_PATH = '/api/v1/organization/members';

/** Polish copy from `ManageMembersPage` (`apps/web/.../manage/members/page.tsx`). */
const COPY = {
  title: 'Członkowie',
  removeAction: 'Usuń członka',
  dialogTitle: 'Usunąć z organizacji?',
  dialogDescription: 'Ten członek straci dostęp do zasobów organizacji.',
  cancel: 'Anuluj',
  confirm: 'Usuń',
  removed: 'Członek usunięty z organizacji',
  self: '(ty)',
  total: (count: number) => `${count} łącznie`,
} as const;

interface OrgMember {
  id: string;
  email: string;
  full_name: string | null;
  orgRoleName: string;
  orgRoleId: string;
  created_at: string;
  groups: Array<{ id: string; name: string; role: string }>;
}

interface MyGroup {
  id: string;
  name: string;
  organizationId: string;
  role: string;
}

interface MyOrg {
  id: string;
  name: string;
  orgRoleName: string;
  isActive: boolean;
}

/** GET a `/api/v1` endpoint as the signed-in user and unwrap `{ success, data }`. */
async function readData<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path);
  expect(response.status(), `GET ${path}`).toBe(200);
  const body = (await response.json()) as { success: boolean; data: T };
  expect(body.success, `${path} response`).toBe(true);
  return body.data;
}

async function listMembers(page: Page): Promise<OrgMember[]> {
  return readData<OrgMember[]>(page, MEMBERS_PATH);
}

/** One table row per member; the e-mail is unique inside the tenant. */
function memberRow(page: Page, email: string): Locator {
  return page.locator('table tbody tr').filter({ hasText: email });
}

/** The per-row remove control carries an sr-only „Usuń członka <name>” label. */
function removeButton(row: Locator): Locator {
  return row.getByRole('button', { name: new RegExp(`^${COPY.removeAction} `) });
}

function removeDialog(page: Page): Locator {
  return page.getByRole('alertdialog');
}

/** Counts every DELETE the page sends, so a cancelled dialog can prove a no-op. */
function countMemberDeletes(page: Page): () => number {
  let deletes = 0;
  page.on('request', (request) => {
    if (request.method() === 'DELETE' && new URL(request.url()).pathname === MEMBERS_PATH) {
      deletes += 1;
    }
  });
  return () => deletes;
}

/** Sign in as the tenant manager with this case's organization active. */
async function signInAsManager(page: Page, tenant: QaTenant): Promise<void> {
  const orgId = tenant.org?.id;
  if (!orgId) throw new Error(`${CASE} needs the content tenant profile (org + manager)`);

  await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage(\/|$)/ });
  // Org-scoped endpoints resolve the organization from this cookie; pin it to
  // the tenant's own org so an earlier session's active org cannot leak in.
  await page
    .context()
    .addCookies([{ name: 'active_org_id', value: orgId, domain: HOST, path: '/', httpOnly: true }]);
}

/** Open /manage/members as the manager and wait for the member list. */
async function openMembers(page: Page, tenant: QaTenant): Promise<void> {
  await signInAsManager(page, tenant);
  await page.goto('/manage/members');
  await expect(page).toHaveURL(/\/manage\/members$/, { timeout: 20_000 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
  await expect(page.getByRole('heading', { level: 2, name: COPY.title })).toBeVisible();
  await expect(page.locator('table tbody tr').first()).toBeVisible();
}

test('removes a member and the removed user loses access to the organization', async ({ page }) => {
  const tenant = loadTenant(CASE);
  const org = tenant.org;
  const student = tenant.users.student;
  const group = tenant.group;
  if (!org || !student || !group) {
    throw new Error(`${CASE} needs the content tenant profile (org + student + group)`);
  }

  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  // --- Step 0: before the removal the student does see the organization ----
  // Without this baseline, an empty post-removal state could also mean a broken
  // fixture instead of a lost membership.
  await page.context().clearCookies();
  await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });

  const beforeOrgs = await readData<MyOrg[]>(page, '/api/v1/me/orgs');
  expect(
    beforeOrgs.map((row) => row.id),
    'orgs before removal',
  ).toContain(org.id);
  const beforeGroups = await readData<MyGroup[]>(page, '/api/v1/me/groups');
  expect(
    beforeGroups.map((row) => row.id),
    'classes before removal',
  ).toContain(group.id);

  await page.goto('/app');
  await expect(page.getByText(org.name, { exact: true })).toBeVisible({ timeout: 20_000 });

  // --- Step 1: the manager removes the seeded student ----------------------
  await page.context().clearCookies();
  await openMembers(page, tenant);

  const before = await listMembers(page);
  const target = before.find((member) => member.email === student.email);
  expect(target, 'the seeded student is an organization member').toBeTruthy();

  const row = memberRow(page, student.email);
  await expect(row).toHaveCount(1);
  // The row is removable: it carries the action and not the self marker.
  await expect(removeButton(row)).toHaveCount(1);
  await expect(row.getByText(COPY.self, { exact: true })).toHaveCount(0);

  // --- Step 1a: the confirmation dialog -----------------------------------
  await removeButton(row).click();

  const dialog = removeDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(COPY.dialogTitle, { exact: true })).toBeVisible();
  await expect(dialog.getByText(COPY.dialogDescription, { exact: true })).toBeVisible();

  // --- Step 1b: confirm → one DELETE for exactly this member --------------
  const deleteResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'DELETE' && new URL(response.url()).pathname === MEMBERS_PATH,
  );
  await dialog.getByRole('button', { name: COPY.confirm, exact: true }).click();
  const response = await deleteResponse;

  expect(response.status(), `DELETE ${MEMBERS_PATH}`).toBe(200);
  expect(
    new URL(response.url()).searchParams.get('userId'),
    'the delete targets the removed member',
  ).toBe(student.id);
  await expect(dialog).toHaveCount(0);

  // Expected: the success toast.
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: COPY.removed })).toBeVisible();

  // --- Step 2: after a refresh the member is gone from the list -----------
  await page.reload();

  const expectedTotal = before.length - 1;
  await expect(page.getByText(COPY.total(expectedTotal), { exact: true })).toBeVisible();
  await expect(page.locator('table tbody tr')).toHaveCount(expectedTotal);
  await expect(memberRow(page, student.email)).toHaveCount(0);

  const after = await listMembers(page);
  expect(
    after.map((member) => member.id),
    'members after removal',
  ).not.toContain(student.id);
  expect(after.map((member) => member.id)).toContain(tenant.users.manager!.id);
  expect(after.map((member) => member.id)).toContain(tenant.users.teacher!.id);

  // --- Step 3: the removed user no longer reaches the organization's data --
  await page.context().clearCookies();
  // A removed member has no org context left: seed no `active_org_id` cookie.
  await loginAs(page, tenant, 'student', {
    locale: 'pl',
    activeOrgId: null,
    waitFor: /\/app(\/|$)/,
  });

  const orgsAfter = await readData<MyOrg[]>(page, '/api/v1/me/orgs');
  expect(orgsAfter, 'the removed user belongs to no organization').toEqual([]);

  const groupsAfter = await readData<MyGroup[]>(page, '/api/v1/me/groups');
  expect(groupsAfter, 'the removed user sees no class').toEqual([]);

  // Org-scoped management endpoints stay closed to a non-member.
  expect(
    (await page.request.get(MEMBERS_PATH)).status(),
    `GET ${MEMBERS_PATH} as the removed user`,
  ).toBe(403);
  expect(
    (await page.request.get('/api/v1/organization/groups')).status(),
    'GET /api/v1/organization/groups as the removed user',
  ).toBe(403);

  // The student shell falls back to the standalone app: the organization is
  // gone from the navbar.
  await page.goto('/app');
  await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });
  await expect(page.getByText(org.name, { exact: true })).toHaveCount(0);

  expect(pageErrors, 'uncaught page errors').toEqual([]);
});

test('cancelling the confirmation removes nobody and sends no request', async ({ page }) => {
  const tenant = loadTenant(CASE);
  const teacher = tenant.users.teacher;
  if (!tenant.org || !teacher) {
    throw new Error(`${CASE} needs the content tenant profile (org + teacher)`);
  }

  await openMembers(page, tenant);

  const deletes = countMemberDeletes(page);

  const row = memberRow(page, teacher.email);
  await expect(row).toHaveCount(1);

  await removeButton(row).click();
  const dialog = removeDialog(page);
  await expect(dialog.getByText(COPY.dialogTitle, { exact: true })).toBeVisible();

  await dialog.getByRole('button', { name: COPY.cancel, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: COPY.removed })).toHaveCount(
    0,
  );

  // Nothing was sent and the membership survived, including after a refresh.
  expect(deletes(), 'a cancelled dialog must not reach the API').toBe(0);

  await page.reload();
  await expect(memberRow(page, teacher.email)).toHaveCount(1);
  const members = await listMembers(page);
  expect(members.map((member) => member.email)).toContain(teacher.email);
});

test('the manager cannot remove their own membership', async ({ page }) => {
  const tenant = loadTenant(CASE);
  const manager = tenant.users.manager;
  if (!tenant.org || !manager) {
    throw new Error(`${CASE} needs the content tenant profile (org + manager)`);
  }

  await openMembers(page, tenant);

  const row = memberRow(page, manager.email);
  await expect(row).toHaveCount(1);
  // The own row is marked "(ty)" and offers no destructive action at all.
  await expect(row.getByText(COPY.self, { exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: new RegExp(`^${COPY.removeAction} `) })).toHaveCount(
    0,
  );

  // The API refuses the same request even when it is forced past the UI.
  const forced = await page.request.delete(`${MEMBERS_PATH}?userId=${manager.id}`);
  expect(forced.status(), 'DELETE own membership').toBe(403);

  await page.reload();
  const members = await listMembers(page);
  expect(
    members.map((member) => member.id),
    'the manager still belongs to the org',
  ).toContain(manager.id);
});
