import { randomUUID } from 'node:crypto';
import { expect, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs, test, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * MGR-MEM-02 — Zmiana roli członka (`/manage/members`).
 *
 * Prerequisite: a signed-in organization manager and one member in the `member`
 * org role. That is the case's own `content` tenant, seeded with a fresh run
 * suffix before every independent run:
 *
 *   bun scripts/qa-tenant.ts MGR-MEM-02 --fresh
 *
 * The tenant gives the manager an `admin` role and a student in `member` inside
 * `qa-mgr-mem-02-<suffix>` (`tenantKey('qa/cases/MGR-MEM-02.md',
 * 'MGR-MEM-02#<suffix>', 'qa-shared')` + `tenantId`). The page and the members
 * API both scope themselves from the `active_org_id` cookie the fixture seeds, so
 * every row the test touches belongs to this tenant. No global admin setting,
 * feature flag, plan row or another worker's tenant is read or written.
 *
 * Role labels come from `GET /api/v1/organization/roles` (`order('name')`), not
 * from the page: the seeded `member` role renders as „Student” (its
 * `display_name`, the same label invitations use), while the case text calls the
 * same role „Member”. The case asks for the *organization's* roles in the picker,
 * so the spec pins the picker against that endpoint instead of hard-coding
 * labels. A custom role would be served by the same endpoint; this tenant's
 * `launch` plan does not include the role builder, so only system roles exist.
 *
 * The case also asks to record the confirmation copy. The walk confirmed:
 * title „Zmienić rolę?”, description „Czy na pewno chcesz zmienić Teacher?”,
 * buttons „Anuluj” / „Potwierdź”. The sentence is incomplete („zmienić Teacher”
 * instead of „zmienić rolę na Teacher”) — the P3 language note the case itself
 * flags — so the spec asserts the dialog's job (confirm before writing, name the
 * target role) without freezing the exact wording that a copy fix may change.
 */

const CASE = 'MGR-MEM-02';

const MEMBERS_PATH = '/manage/members';
const MEMBERS_API = '/api/v1/organization/members';

/** Polish copy the case's expected result pins. */
const HEADING = 'Członkowie';
const TOAST_UPDATED = 'Rola zaktualizowana';
const DIALOG_TITLE = 'Zmienić rolę?';
/** The case's template is „Czy na pewno chcesz zmienić {role}?”. */
const DIALOG_DESCRIPTION_PREFIX = 'Czy na pewno chcesz zmienić';
const CONFIRM = 'Potwierdź';
const CANCEL = 'Anuluj';

/** Org roles as served by the roles endpoint. */
interface OrgRole {
  id: string;
  name: string;
  displayName: string;
  isSystem: boolean;
}

/** The subset of a member row the case depends on. */
interface OrgMember {
  id: string;
  email: string;
  orgRoleName: string;
  orgRoleId: string;
}

async function fetchRoles(page: Page): Promise<OrgRole[]> {
  const res = await page.request.get('/api/v1/organization/roles');
  expect(res.status(), 'GET /api/v1/organization/roles').toBe(200);
  const body = (await res.json()) as { success: boolean; data: OrgRole[] };
  expect(body.success).toBe(true);
  return body.data;
}

async function fetchMember(page: Page, email: string): Promise<OrgMember> {
  const res = await page.request.get(MEMBERS_API);
  expect(res.status(), `GET ${MEMBERS_API}`).toBe(200);
  const body = (await res.json()) as { success: boolean; data: OrgMember[] };
  expect(body.success).toBe(true);
  const member = body.data.find((row) => row.email === email);
  if (!member) throw new Error(`member ${email} is not in the tenant's organization`);
  return member;
}

/** The table row of one member, found by e-mail (row order is not asserted). */
function memberRow(page: Page, email: string): Locator {
  return page.locator('table tbody tr').filter({ hasText: email });
}

async function expectRoleCell(row: Locator, label: string): Promise<void> {
  await expect(row.locator('[data-testid="member-role"]')).toHaveText(label);
}

/** Opens the row's role picker and returns the options exactly as rendered. */
async function openRolePicker(page: Page, row: Locator): Promise<string[]> {
  await row.getByRole('combobox').click();
  const options = page.getByRole('option');
  await expect(options.first()).toBeVisible();
  return options.allInnerTexts();
}

/** Picks a role, asserts the confirmation dialog names it, and confirms. */
async function changeRole(
  page: Page,
  row: Locator,
  roles: OrgRole[],
  displayName: string,
): Promise<void> {
  const role = roles.find((candidate) => candidate.displayName === displayName);
  if (!role) throw new Error(`org role "${displayName}" is missing from the tenant`);

  await row.getByRole('combobox').click();
  await page.getByRole('option', { name: displayName, exact: true }).click();

  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(DIALOG_TITLE, { exact: true })).toBeVisible();
  // The dialog must name the target role it is about to apply.
  await expect(dialog).toContainText(DIALOG_DESCRIPTION_PREFIX);
  await expect(dialog).toContainText(displayName);

  const written = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' && new URL(response.url()).pathname === MEMBERS_API,
  );
  await dialog.getByRole('button', { name: CONFIRM, exact: true }).click();
  const response = await written;
  expect(response.status(), `PUT ${MEMBERS_API} (${displayName})`).toBe(200);
  expect(await response.json()).toMatchObject({ success: true, data: { success: true } });
}

test('a manager changes a member role to Teacher, keeps it across a reload, and restores Member', async ({
  page,
}) => {
  const tenant: QaTenant = loadTenant(CASE);
  expect(tenant.profile, `${CASE} runs on the content tenant profile`).toBe('content');
  const org = tenant.org;
  const student = tenant.users.student;
  const manager = tenant.users.manager;
  if (!org || !student || !manager) {
    throw new Error(
      `MGR-MEM-02 fixture incomplete: run \`bun scripts/qa-tenant.ts ${CASE} --fresh\``,
    );
  }

  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  let memberWrites = 0;
  page.on('request', (request) => {
    if (request.method() === 'PUT' && new URL(request.url()).pathname === MEMBERS_API) {
      memberWrites += 1;
    }
  });

  // --- Prerequisite: the tenant's manager, signed in, on the members page ---
  await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage/ });
  await page.goto(MEMBERS_PATH);
  await expect(page).toHaveURL(new RegExp(`${MEMBERS_PATH}$`), { timeout: 20_000 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
  await expect(page.getByRole('heading', { name: HEADING, exact: true })).toBeVisible();

  /** „S1” from the case: the tenant's `member` in the manager's organization. */
  const row = memberRow(page, student.email);
  await expect(row).toHaveCount(1);
  await expectRoleCell(row, 'Student');

  const roles = await fetchRoles(page);
  expect(
    roles.map((role) => role.name).sort(),
    'the tenant has the three system org roles',
  ).toEqual(['admin', 'member', 'teacher']);
  expect(roles.map((role) => role.displayName).sort()).toEqual(['Admin', 'Student', 'Teacher']);

  const initial = await fetchMember(page, student.email);
  expect(initial.id).toBe(student.id);
  expect(initial.orgRoleName).toBe('member');

  // --- „Dostępne role to role organizacji”: picker === roles endpoint ------
  // Rendered in `order('name')`, labelled with `displayName`.
  const orderedLabels = [...roles]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((role) => role.displayName);
  expect(await openRolePicker(page, row), 'role picker options').toEqual(orderedLabels);

  // Cancelling the confirmation must not write anything (no PUT, no change).
  await page.getByRole('option', { name: 'Teacher', exact: true }).click();
  const cancelDialog = page.getByRole('alertdialog');
  await expect(cancelDialog).toBeVisible();
  await expect(cancelDialog.getByText(DIALOG_DESCRIPTION_PREFIX)).toBeVisible();
  await cancelDialog.getByRole('button', { name: CANCEL, exact: true }).click();
  await expect(cancelDialog).toHaveCount(0);
  await expectRoleCell(row, 'Student');
  await expect(row.getByRole('combobox')).toHaveText('Student');
  expect(memberWrites, 'cancelling the dialog sends no PUT').toBe(0);

  // --- Step 1 + 2: change to „Teacher” and confirm -------------------------
  await changeRole(page, row, roles, 'Teacher');

  // Expected result: toast „Rola zaktualizowana”; the table role changes.
  const updatedToast = page
    .locator('[data-sonner-toast]')
    .filter({ hasText: TOAST_UPDATED })
    .first();
  await expect(updatedToast).toBeVisible();
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: /Nie udało się/ }),
  ).toHaveCount(0);
  await expectRoleCell(row, 'Teacher');
  await expect(row.getByRole('combobox')).toHaveText('Teacher');

  // The write really landed on this tenant's member row.
  const promoted = await fetchMember(page, student.email);
  expect(promoted.orgRoleName).toBe('teacher');
  expect(promoted.orgRoleId).toBe(roles.find((role) => role.name === 'teacher')?.id);

  // --- Step 3a: the role survives a reload --------------------------------
  await page.reload();
  await expect(page.getByRole('heading', { name: HEADING, exact: true })).toBeVisible();
  const reloadedRow = memberRow(page, student.email);
  await expect(reloadedRow).toHaveCount(1);
  await expectRoleCell(reloadedRow, 'Teacher');
  await expect(reloadedRow.getByRole('combobox')).toHaveText('Teacher');

  // Wait out the first toast so the restore assertion is about a fresh toast.
  await expect(updatedToast).toHaveCount(0, { timeout: 15_000 });

  // --- Step 3b: restore „Member” (rendered as „Student”) -------------------
  await changeRole(page, reloadedRow, roles, 'Student');

  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: TOAST_UPDATED }).first(),
  ).toBeVisible();
  await expectRoleCell(reloadedRow, 'Student');
  await expect(reloadedRow.getByRole('combobox')).toHaveText('Student');

  const restored = await fetchMember(page, student.email);
  expect(restored.orgRoleName).toBe('member');
  expect(restored.orgRoleId).toBe(roles.find((role) => role.name === 'member')?.id);

  await page.reload();
  await expect(page.getByRole('heading', { name: HEADING, exact: true })).toBeVisible();
  const restoredRow = memberRow(page, student.email);
  await expectRoleCell(restoredRow, 'Student');

  // --- Adjacent guards on the same surface --------------------------------
  // The manager's own row offers no role picker — MGR-MEM-03's subject — and
  // the API behind the picker refuses a self-change instead of silently
  // succeeding. The manager stays the organization's admin.
  const selfRow = memberRow(page, manager.email);
  await expect(selfRow).toHaveCount(1);
  await expectRoleCell(selfRow, 'Admin');
  await expect(selfRow.getByRole('combobox')).toHaveCount(0);
  await expect(selfRow).toContainText('(ty)');

  const selfChange = await page.request.put(MEMBERS_API, {
    data: {
      targetUserId: manager.id,
      newOrgRoleId: roles.find((role) => role.name === 'teacher')?.id,
    },
  });
  expect(selfChange.status(), 'PUT a self role change').toBe(403);
  expect(await selfChange.json()).toMatchObject({ success: false, error: 'FORBIDDEN' });
  expect((await fetchMember(page, manager.email)).orgRoleName).toBe('admin');

  // A role id outside the active organization is refused, and the member it
  // was aimed at keeps the role the manager restored.
  const foreignChange = await page.request.put(MEMBERS_API, {
    data: { targetUserId: student.id, newOrgRoleId: randomUUID() },
  });
  expect(foreignChange.status(), 'PUT a role id outside the tenant org').toBe(403);
  expect(await foreignChange.json()).toMatchObject({ success: false, error: 'FORBIDDEN' });
  expect((await fetchMember(page, student.email)).orgRoleName).toBe('member');

  expect(pageErrors, 'uncaught page errors').toEqual([]);
});
