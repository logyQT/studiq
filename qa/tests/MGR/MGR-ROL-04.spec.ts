import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * MGR-ROL-04 — deleting roles and the limits on it (`/manage/roles`).
 *
 * Prerequisite (case text: „Rola niestandardowa z członkiem i rola bez członków”):
 * the `content` profile — one organization with a manager, a teacher and a
 * student — plus the role builder. `qa/tests/profiles/<CASE>.json` declares
 * `{ profile: "content", plan: "hub" }`: `--plan hub` puts *this tenant's own*
 * organization on Hub through `apply_org_plan`, the same path MGR-ROL-02 uses,
 * because the role write endpoints require `role.builder` (#259). Nothing global
 * is written: no admin setting, feature flag, plan catalog row, platform stat or
 * singleton.
 *
 *   bun scripts/qa-tenant.ts MGR-ROL-04 --fresh
 *
 * Every independent run needs a fresh tenant: the spec creates the case's two
 * custom roles through the product API and one of them is deleted for real.
 *
 * Acceptance criteria (case text):
 * - system role: „Ról systemowych nie można usuwać”;
 * - role with members: „Usuń wszystkich członków z tej roli przed usunięciem”;
 * - empty custom role: deleted with the toast „Rola usunięta”.
 *
 * Step 1 observation: the UI does not render a delete control for a system role
 * at all (`RolesPage` renders it only for `!role.isSystem`), so a manager cannot
 * even open the confirmation dialog for one. That is the intended guard — the
 * same shape as self-removal on `/manage/members` — and the API is the second
 * line of defence: a forced `DELETE` answers `403 FORBIDDEN`, which the page
 * would surface as „Ról systemowych nie można usuwać”. The spec asserts the
 * guard (no control) and the API refusal instead of a toast that the UI cannot
 * reach.
 */

const CASE = 'MGR-ROL-04';
const APP_URL = process.env.QA_APP_URL ?? 'http://localhost:3010';
const HOST = new URL(APP_URL).hostname;
const ROLES_URL = '/api/v1/organization/roles';
const MEMBERS_URL = '/api/v1/organization/members';

/** Polish copy from `ManageRolesPage` (`apps/web/src/i18n/messages/pl.json`). */
const COPY = {
  title: 'Role',
  create: 'Nowa rola',
  typeSystem: 'Systemowa',
  typeCustom: 'Niestandardowa',
  deleteTitle: 'Usunąć rolę?',
  deleteDescription:
    'Tej operacji nie można cofnąć. Członkowie przypisani do tej roli będą potrzebować nowej roli.',
  cancel: 'Anuluj',
  confirm: 'Usuń',
  deleted: 'Rola usunięta',
  cantDeleteHasMembers: 'Usuń wszystkich członków z tej roli przed usunięciem',
} as const;

const SYSTEM_ROLES = ['admin', 'teacher', 'member'] as const;
const FILLED_ROLE = 'Asystent QA';
const EMPTY_ROLE = 'Pusta QA';
const CANCEL_ROLE = 'Anulowana QA';

interface OrgRole {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  isSystem: boolean;
  memberCount: number;
  permissionCount: number;
}

interface OrgMember {
  id: string;
  email: string;
  orgRoleId: string;
  orgRoleName: string;
}

/** GET a `/api/v1` endpoint as the signed-in manager and unwrap `{ success, data }`. */
async function readData<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path);
  expect(response.status(), `GET ${path}`).toBe(200);
  const body = (await response.json()) as { success: boolean; data: T };
  expect(body.success, `${path} response`).toBe(true);
  return body.data;
}

async function listRoles(page: Page): Promise<OrgRole[]> {
  return readData<OrgRole[]>(page, ROLES_URL);
}

async function listMembers(page: Page): Promise<OrgMember[]> {
  return readData<OrgMember[]>(page, MEMBERS_URL);
}

/** Create a custom role through the same API the create dialog calls. */
async function createRole(page: Page, name: string, description: string): Promise<string> {
  const response = await page.request.post(ROLES_URL, { data: { name, description } });
  expect(response.status(), `POST ${ROLES_URL} (${name})`).toBe(201);
  const body = (await response.json()) as { success: boolean; data: { id: string } };
  expect(body.success, `create ${name}`).toBe(true);
  return body.data.id;
}

/** Assign an org member to a role through the member-role API. */
async function assignRole(page: Page, userId: string, roleId: string): Promise<void> {
  const response = await page.request.put(MEMBERS_URL, {
    data: { targetUserId: userId, newOrgRoleId: roleId },
  });
  expect(response.status(), `PUT ${MEMBERS_URL}`).toBe(200);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The row whose name cell is exactly `name` (the e-mail/description may repeat). */
function roleRow(page: Page, name: string): Locator {
  return page.locator('table tbody tr').filter({
    has: page.locator('p.font-medium', { hasText: new RegExp(`^${escapeRegExp(name)}$`) }),
  });
}

function deleteButton(row: Locator, name: string): Locator {
  return row.getByRole('button', { name: `Usuń rolę ${name}`, exact: true });
}

function deleteDialog(page: Page): Locator {
  return page.getByRole('dialog');
}

async function expectToast(page: Page, text: string): Promise<void> {
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: text })).toBeVisible();
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

/**
 * Open /manage/roles. `role.builder` arrives with `/features/me`, and the write
 * UI is fail-closed until it resolves, so the create button is the readiness
 * signal for the whole action column.
 */
async function openRoles(page: Page, tenant: QaTenant): Promise<void> {
  await signInAsManager(page, tenant);
  await page.goto('/manage/roles');
  await expect(page).toHaveURL(/\/manage\/roles$/, { timeout: 20_000 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
  await expect(page.getByRole('heading', { level: 1, name: COPY.title })).toBeVisible();
  await expect(page.getByRole('button', { name: COPY.create, exact: true })).toBeVisible();
}

/** Open the delete dialog for one custom role. */
async function openDeleteDialog(page: Page, name: string): Promise<Locator> {
  const row = roleRow(page, name);
  await expect(row, `${name} row`).toHaveCount(1);
  await expect(deleteButton(row, name)).toHaveCount(1);
  await deleteButton(row, name).click();

  const dialog = deleteDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(COPY.deleteTitle, { exact: true })).toBeVisible();
  await expect(dialog.getByText(COPY.deleteDescription, { exact: true })).toBeVisible();
  return dialog;
}

test('a system role offers no delete control and the API refuses to delete it', async ({
  page,
}) => {
  const tenant = loadTenant(CASE);
  expect(tenant.plan, `${CASE} needs its tenant org on Hub`).toBe('hub');

  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await openRoles(page, tenant);

  // The prerequisite is the `role.builder` feature; assert it from the same
  // endpoint the page's `useFeature()` hook reads.
  const features = await readData<{ features: string[] }>(page, '/api/v1/features/me');
  expect(features.features, 'the org plan unlocks role.builder').toContain('role.builder');

  // --- Step 1: every system role is labelled and has no delete action -------
  const before = await listRoles(page);
  const systemBefore = before.filter((role) => role.isSystem);
  expect(
    systemBefore.map((role) => role.name).sort(),
    'the tenant has the three system roles',
  ).toEqual([...SYSTEM_ROLES].sort());

  for (const name of SYSTEM_ROLES) {
    const row = roleRow(page, name);
    await expect(row, `${name} row`).toHaveCount(1);
    await expect(row.getByText(COPY.typeSystem, { exact: true })).toBeVisible();
    // The permissions and edit controls are there; the destructive one is not.
    await expect(
      row.getByRole('button', { name: `Uprawnienia roli ${name}`, exact: true }),
    ).toHaveCount(1);
    await expect(row.getByRole('button', { name: `Edytuj rolę ${name}`, exact: true })).toHaveCount(
      1,
    );
    await expect(deleteButton(row, name), `delete control for system role ${name}`).toHaveCount(0);
  }

  // --- Forced past the UI: the service still refuses -----------------------
  for (const role of systemBefore) {
    const response = await page.request.delete(`${ROLES_URL}/${role.id}`);
    expect(response.status(), `DELETE system role ${role.name}`).toBe(403);
    const body = (await response.json()) as { success: boolean; error: string };
    expect(body, `DELETE system role ${role.name}`).toEqual({ success: false, error: 'FORBIDDEN' });
  }

  // Nothing was removed and no member lost their role.
  const after = await listRoles(page);
  for (const role of systemBefore) {
    expect(
      after.find((candidate) => candidate.id === role.id),
      `system role ${role.name} still exists`,
    ).toMatchObject({ name: role.name, isSystem: true, memberCount: role.memberCount });
  }

  await page.reload();
  for (const name of SYSTEM_ROLES) {
    await expect(roleRow(page, name), `${name} row after the refused deletes`).toHaveCount(1);
  }

  expect(pageErrors, 'uncaught page errors').toEqual([]);
});

test('refuses to delete a role with a member, then deletes an empty custom role', async ({
  page,
}) => {
  const tenant = loadTenant(CASE);
  const teacher = tenant.users.teacher;
  if (!tenant.org || !teacher) {
    throw new Error(`${CASE} needs the content tenant profile (org + teacher)`);
  }

  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await openRoles(page, tenant);

  // --- Prerequisite: one custom role with a member, one without ------------
  const filledRoleId = await createRole(page, FILLED_ROLE, 'Rola z członkiem');
  await assignRole(page, teacher.id, filledRoleId);
  const emptyRoleId = await createRole(page, EMPTY_ROLE, 'Rola bez członków');

  await page.reload();
  await expect(page.getByRole('button', { name: COPY.create, exact: true })).toBeVisible();

  const filledRow = roleRow(page, FILLED_ROLE);
  await expect(filledRow).toHaveCount(1);
  await expect(filledRow.getByText(COPY.typeCustom, { exact: true })).toBeVisible();
  await expect(filledRow.locator('td').nth(2), 'the role has one member').toHaveText('1');

  const emptyRow = roleRow(page, EMPTY_ROLE);
  await expect(emptyRow).toHaveCount(1);
  await expect(emptyRow.getByText(COPY.typeCustom, { exact: true })).toBeVisible();
  await expect(emptyRow.locator('td').nth(2), 'the role has no members').toHaveText('0');

  // --- Step 2: the role with a member is refused --------------------------
  const heldDelete = page.waitForResponse(
    (response) =>
      response.request().method() === 'DELETE' &&
      new URL(response.url()).pathname === `${ROLES_URL}/${filledRoleId}`,
  );
  const conflictDialog = await openDeleteDialog(page, FILLED_ROLE);
  await conflictDialog.getByRole('button', { name: COPY.confirm, exact: true }).click();

  const conflictResponse = await heldDelete;
  expect(conflictResponse.status(), 'DELETE a role with members').toBe(409);
  expect(await conflictResponse.json(), 'conflict body').toEqual({
    success: false,
    error: 'CONFLICT',
  });
  await expect(conflictDialog).toHaveCount(0);
  await expectToast(page, COPY.cantDeleteHasMembers);

  // The role and the assignment survive, including after a refresh.
  await page.reload();
  await expect(roleRow(page, FILLED_ROLE)).toHaveCount(1);
  await expect(roleRow(page, FILLED_ROLE).locator('td').nth(2)).toHaveText('1');

  const rolesAfterConflict = await listRoles(page);
  expect(
    rolesAfterConflict.find((role) => role.id === filledRoleId),
    'the refused role still exists',
  ).toMatchObject({ name: FILLED_ROLE, isSystem: false, memberCount: 1 });
  const membersAfterConflict = await listMembers(page);
  expect(
    membersAfterConflict.find((member) => member.email === teacher.email),
    'the teacher keeps the custom role',
  ).toMatchObject({ orgRoleId: filledRoleId, orgRoleName: 'Asystent QA' });

  // --- Step 3: the empty custom role is deleted ---------------------------
  const deletedEmpty = page.waitForResponse(
    (response) =>
      response.request().method() === 'DELETE' &&
      new URL(response.url()).pathname === `${ROLES_URL}/${emptyRoleId}`,
  );
  const emptyDialog = await openDeleteDialog(page, EMPTY_ROLE);
  await emptyDialog.getByRole('button', { name: COPY.confirm, exact: true }).click();

  const emptyResponse = await deletedEmpty;
  expect(emptyResponse.status(), 'DELETE an empty custom role').toBe(200);
  await expect(emptyDialog).toHaveCount(0);
  await expectToast(page, COPY.deleted);

  // The list is re-fetched after the deletion: the row is gone immediately and
  // the role with a member is untouched.
  await expect(roleRow(page, EMPTY_ROLE)).toHaveCount(0);
  await expect(roleRow(page, FILLED_ROLE)).toHaveCount(1);

  await page.reload();
  await expect(roleRow(page, EMPTY_ROLE)).toHaveCount(0);
  await expect(roleRow(page, FILLED_ROLE)).toHaveCount(1);

  const rolesAfterDelete = await listRoles(page);
  expect(
    rolesAfterDelete.map((role) => role.id),
    'the empty role is gone from the API',
  ).not.toContain(emptyRoleId);
  expect(
    rolesAfterDelete.map((role) => role.id),
    'the role with a member survives',
  ).toContain(filledRoleId);

  expect(pageErrors, 'uncaught page errors').toEqual([]);
});

test('cancelling the delete dialog sends no request and keeps the role', async ({ page }) => {
  const tenant = loadTenant(CASE);
  if (!tenant.org) {
    throw new Error(`${CASE} needs the content tenant profile (org + manager)`);
  }

  await openRoles(page, tenant);
  const roleId = await createRole(page, CANCEL_ROLE, 'Rola do anulowania');

  await page.reload();
  await expect(page.getByRole('button', { name: COPY.create, exact: true })).toBeVisible();

  /** Counts every DELETE the page sends, so a cancelled dialog can prove a no-op. */
  let deletes = 0;
  page.on('request', (request) => {
    if (request.method() === 'DELETE' && new URL(request.url()).pathname.startsWith(ROLES_URL)) {
      deletes += 1;
    }
  });

  const dialog = await openDeleteDialog(page, CANCEL_ROLE);
  await dialog.getByRole('button', { name: COPY.cancel, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: COPY.deleted })).toHaveCount(
    0,
  );
  expect(deletes, 'a cancelled dialog must not reach the API').toBe(0);

  await page.reload();
  await expect(roleRow(page, CANCEL_ROLE)).toHaveCount(1);
  expect(
    (await listRoles(page)).map((role) => role.id),
    'the cancelled role still exists',
  ).toContain(roleId);
});
