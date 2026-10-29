import { expect, test, type Page } from '@playwright/test';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

/**
 * MGR-ROL-02 — creating and editing a custom org role (`/manage/roles`).
 *
 * Case steps: "Utwórz rolę „Asystent”." then "Edytuj jej nazwę i opis."
 * Expected: the toasts „Rola utworzona” / „Rola zaktualizowana” and the type badge
 * „Niestandardowa”.
 *
 * Tenant (deterministic, one per independent run):
 *
 *   bun scripts/qa-tenant.ts MGR-ROL-02 --fresh
 *
 * `__tests__/qa/profiles/<CASE>.json` declares `{ profile: "content", plan: "hub" }`: the
 * `content` tenant gives the org its admin, teacher and student, and `--plan hub`
 * puts *this tenant's own* organization on Hub through `apply_org_plan` — the
 * prerequisite the case states („Włącz role.builder dla organizacji (override w
 * adminie lub plan Hub)”), because the role write endpoints require `role.builder`
 * (#259). Nothing global is written: no admin setting, feature flag, plan catalog
 * row, platform stat or singleton. BIL-04's purchase path is not exercised here;
 * it is reported separately.
 *
 * The spec creates the case's role through the UI, edits it through the UI, and
 * cross-checks the persisted rows with `GET /api/v1/organization/roles`.
 */

const CASE = 'MGR-ROL-02';

/** Polish copy from `ManageRolesPage` (`apps/web/src/i18n/messages/pl.json`). */
const COPY = {
  title: 'Role',
  newRole: 'Nowa rola',
  createTitle: 'Utwórz rolę',
  editTitle: 'Edytuj rolę',
  nameLabel: 'Nazwa roli',
  descriptionLabel: 'Opis (opcjonalny)',
  create: 'Utwórz',
  save: 'Zapisz',
  cancel: 'Anuluj',
  typeSystem: 'Systemowa',
  typeCustom: 'Niestandardowa',
  roleCreated: 'Rola utworzona',
  roleUpdated: 'Rola zaktualizowana',
  locked: 'Kreator ról nie jest dostępny w Twoim planie',
} as const;

const ROLE_NAME = 'Asystent';
const ROLE_NAME_EDITED = 'Asystent organizacji';
const ROLE_DESCRIPTION = 'Wspiera managera w codziennej pracy';

interface OrgRoleRow {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  isSystem: boolean;
  memberCount: number;
  permissionCount: number;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

async function getJson<T>(page: Page, url: string): Promise<T> {
  const res = await page.request.get(url);
  expect(res.ok(), `GET ${url} → ${res.status()} ${await res.text()}`).toBe(true);
  const body = (await res.json()) as ApiEnvelope<T>;
  expect(body.success, `GET ${url} success`).toBe(true);
  return body.data;
}

async function listRoles(page: Page): Promise<OrgRoleRow[]> {
  return getJson<OrgRoleRow[]>(page, '/api/v1/organization/roles');
}

/** The table row whose name cell is exactly `name`. */
function roleRow(page: Page, name: string) {
  return page.locator('table tbody tr').filter({ has: page.getByText(name, { exact: true }) });
}

/** The role dialog currently open (Radix unmounts closed dialogs). */
function roleDialog(page: Page) {
  return page.getByRole('dialog');
}

test('creates „Asystent”, renames it with a description and keeps the custom role persisted', async ({
  page,
}) => {
  const tenant = loadTenant(CASE);
  expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
  expect(tenant.plan, `${CASE} needs its tenant org on Hub`).toBe('hub');
  expect(tenant.org, `${CASE} needs the seeded organization`).toBeTruthy();

  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage(\/|$)/ });

  // --- Prerequisite: the tenant org is entitled to the role builder ---------
  // The case's prerequisite is the `role.builder` feature („plan Hub”); assert it
  // from the same endpoint the page's `useFeature()` hook reads.
  const features = await getJson<{ features: string[] }>(page, '/api/v1/features/me');
  expect(features.features, 'the org plan unlocks role.builder').toContain('role.builder');

  const plan = await getJson<{ key: string }>(page, '/api/v1/me/plan');
  expect(plan.key, 'the active org plan').toBe('hub');

  // The tenant starts with only the three system roles, so „Asystent” is new and
  // this run cannot inherit a role from an earlier one.
  const before = await listRoles(page);
  expect(
    before.filter((role) => !role.isSystem).map((role) => role.name),
    'a fresh tenant starts without custom roles',
  ).toEqual([]);
  expect(before.map((role) => role.name).sort()).toEqual(['admin', 'member', 'teacher']);
  expect(
    before.some((role) => role.name === ROLE_NAME),
    `„${ROLE_NAME}” does not exist yet`,
  ).toBe(false);

  // --- Step 0: the roles list is writable on this plan ---------------------
  await page.goto('/manage/roles');
  await expect(page).toHaveURL(/\/manage\/roles$/, { timeout: 20_000 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
  await expect(page.getByRole('heading', { level: 1, name: COPY.title })).toBeVisible();

  // An entitled org sees the builder, never the Launch locked card (#259).
  await expect(page.getByText(COPY.locked, { exact: true })).toHaveCount(0);

  const newRoleButton = page.getByRole('button', { name: COPY.newRole, exact: true });
  await expect(newRoleButton).toBeVisible();

  for (const systemRole of ['admin', 'teacher', 'member']) {
    const row = roleRow(page, systemRole);
    await expect(row, `${systemRole} is listed`).toHaveCount(1);
    await expect(row.getByText(COPY.typeSystem, { exact: true })).toBeVisible();
  }

  // --- Step 1: create „Asystent” ------------------------------------------
  await newRoleButton.click();

  const createDialog = roleDialog(page);
  await expect(createDialog).toBeVisible();
  await expect(
    createDialog.getByRole('heading', { level: 2, name: COPY.createTitle }),
  ).toBeVisible();
  await expect(createDialog.getByText(COPY.nameLabel, { exact: true })).toBeVisible();
  await expect(createDialog.getByText(COPY.descriptionLabel, { exact: true })).toBeVisible();

  const createInputs = createDialog.locator('input');
  await expect(createInputs).toHaveCount(2);
  await createInputs.nth(0).fill(ROLE_NAME);
  await expect(createInputs.nth(0)).toHaveValue(ROLE_NAME);
  await createDialog.getByRole('button', { name: COPY.create, exact: true }).click();

  // --- Expected result: toast „Rola utworzona” + „Niestandardowa” row ------
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: COPY.roleCreated }),
    'success toast after creating the role',
  ).toBeVisible();
  await expect(createDialog, 'the create dialog closes after saving').toHaveCount(0);

  const createdRow = roleRow(page, ROLE_NAME);
  await expect(createdRow, `„${ROLE_NAME}” is in the role list`).toHaveCount(1);
  await expect(createdRow.getByText(COPY.typeCustom, { exact: true })).toBeVisible();
  await expect(createdRow.getByText(COPY.typeSystem, { exact: true })).toHaveCount(0);

  // Server state: one custom (non-system) role named „Asystent”.
  const afterCreate = await listRoles(page);
  const created = afterCreate.filter((role) => role.name === ROLE_NAME);
  expect(created, 'the API exposes exactly one „Asystent” role').toHaveLength(1);
  expect(created[0].isSystem, '„Asystent” is not a system role').toBe(false);
  expect(created[0].description).toBeNull();
  expect(created[0].memberCount, 'a brand-new role has no members').toBe(0);

  // --- Step 2: edit its name and description ------------------------------
  const editButton = createdRow.getByRole('button', {
    name: `Edytuj rolę ${ROLE_NAME}`,
    exact: true,
  });
  await expect(editButton).toBeVisible();
  await editButton.click();

  const editDialog = roleDialog(page);
  await expect(editDialog).toBeVisible();
  await expect(editDialog.getByRole('heading', { level: 2, name: COPY.editTitle })).toBeVisible();

  const editInputs = editDialog.locator('input');
  await expect(editInputs).toHaveCount(2);
  await expect(editInputs.nth(0), 'the edit form is prefilled with the role name').toHaveValue(
    ROLE_NAME,
  );
  await expect(editInputs.nth(1), 'the edit form starts without a description').toHaveValue('');

  await editInputs.nth(0).fill(ROLE_NAME_EDITED);
  await editInputs.nth(1).fill(ROLE_DESCRIPTION);
  await editDialog.getByRole('button', { name: COPY.save, exact: true }).click();

  // --- Expected result: toast „Rola zaktualizowana” + updated row ----------
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: COPY.roleUpdated }),
    'success toast after updating the role',
  ).toBeVisible();
  await expect(editDialog, 'the edit dialog closes after saving').toHaveCount(0);

  const updatedRow = roleRow(page, ROLE_NAME_EDITED);
  await expect(updatedRow, 'the renamed role is listed').toHaveCount(1);
  await expect(updatedRow.getByText(ROLE_DESCRIPTION, { exact: true })).toBeVisible();
  await expect(updatedRow.getByText(COPY.typeCustom, { exact: true })).toBeVisible();
  await expect(roleRow(page, ROLE_NAME), 'the old name is gone (rename, not a copy)').toHaveCount(
    0,
  );

  // --- API cross-check: renamed in place, display name in sync -------------
  // `display_name` is what member/invite pickers show; the rename must keep it
  // equal to `name` (#260), not leave the old label behind.
  const afterUpdate = await listRoles(page);
  const renamed = afterUpdate.filter((role) => role.id === created[0].id);
  expect(renamed, 'the role kept its id').toHaveLength(1);
  expect(renamed[0]).toMatchObject({
    name: ROLE_NAME_EDITED,
    displayName: ROLE_NAME_EDITED,
    description: ROLE_DESCRIPTION,
    isSystem: false,
  });
  expect(
    afterUpdate.filter((role) => !role.isSystem),
    'the tenant has exactly the one edited custom role',
  ).toHaveLength(1);

  // --- Regression: the system roles are untouched -------------------------
  for (const systemRole of ['admin', 'teacher', 'member']) {
    const row = roleRow(page, systemRole);
    await expect(row.getByText(COPY.typeSystem, { exact: true })).toBeVisible();
    const apiRole = afterUpdate.find((role) => role.name === systemRole);
    expect(apiRole?.isSystem, `${systemRole} is still a system role`).toBe(true);
  }

  // --- Persistence: a reload serves the updated role from the database -----
  await page.reload();
  await expect(page).toHaveURL(/\/manage\/roles$/, { timeout: 20_000 });

  const reloadedRow = roleRow(page, ROLE_NAME_EDITED);
  await expect(reloadedRow, 'the role survives a reload').toHaveCount(1);
  await expect(reloadedRow.getByText(ROLE_DESCRIPTION, { exact: true })).toBeVisible();
  await expect(reloadedRow.getByText(COPY.typeCustom, { exact: true })).toBeVisible();
  await expect(roleRow(page, ROLE_NAME)).toHaveCount(0);

  expect(pageErrors, 'uncaught page errors').toEqual([]);
});
