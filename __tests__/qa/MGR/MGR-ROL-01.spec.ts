import { expect, test, type Page } from '@playwright/test';
import { json } from '#test/helpers/json';
import { loadTenant, loginAs, tenantUser, type QaTenant } from '#test/qa/fixtures/tenant';

/**
 * MGR-ROL-01 — the role-write gate is a permission, not a plan feature.
 *
 * The case was written on the premise that Launch lacks `role.builder`, so its
 * step ("Kliknij „Nowa rola”, nazwa „Asystent”, opis; zapisz") ends in a 403 and
 * asks whether the UI warns about the missing plan. Phase 2a-2 replaces the
 * entitlement gate with `org.role.manage` (ADR-0015 §4.4): the **plan** no longer
 * gates role writes, the caller's role does. The organization's Admin role holds
 * `org.role.manage` on every plan, so on Launch:
 *
 * 1. the manager (org role `admin`) sees the editor and can create/edit a role —
 *    no locked card, no plan upgrade path;
 * 2. a same-org member whose role does not hold `org.role.manage` (the tenant's
 *    teacher) is refused by the API with 403 and has no editor. The persona route
 *    rule still sends an educator away from `/manage`, so the absence of the
 *    editor is asserted where the permission gate lives — `/me/permissions`
 *    (no key) and the write endpoints (403);
 * 3. a **manager-account-type** member holding a custom role without the gate is
 *    the client-gate deny case: `/manage/roles` renders (the persona rule admits a
 *    manager), and only the permission withholds „Nowa rola”, the actions column
 *    and the API write.
 *
 * Tenant: the `content` profile of this case
 * (`__tests__/qa/profiles/MGR-ROL-01.json`), seeded before the suite starts by
 * `bun scripts/qa-tenant.ts MGR-ROL-01 --fresh`: one organization on Launch with
 * an `admin` manager, a teacher, a student, a `roleless` manager-account-type
 * member and the default group `G1`, all derived from the case id + run suffix.
 * The `roleless` member is given the custom role the admin creates here, through
 * the members API — no service-role write. Nothing global is written.
 */

const CASE = 'MGR-ROL-01';
const TENANT: QaTenant = loadTenant(CASE);

const ROLE_NAME = 'Asystent';
const ROLE_DESCRIPTION = 'Rola testowa MGR-ROL-01';
const ROLE_NAME_EDITED = 'Asystent organizacji';

interface OrgRoleRow {
  id: string;
  name: string;
  isSystem: boolean;
  permissionCount: number;
}

interface OrgRoleDetail extends OrgRoleRow {
  permissions: { permissionName: string; scope: string }[];
}

interface PlanInfo {
  key: string;
  name: string;
}

/** `GET` an endpoint as the signed-in user and unwrap the response envelope. */
async function getData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.status(), `GET ${url}`).toBe(200);
  const body = await json<{ success: boolean; data: T }>(response);
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data;
}

function roleRow(page: Page, name: string) {
  return page.getByRole('row').filter({ has: page.getByText(name, { exact: true }) });
}

test.describe('@case:MGR-ROL-01 @area:MGR @prio:P2 role management permission', () => {
  test('the Launch-plan admin writes roles while a member without org.role.manage is refused', async ({
    page,
    browser,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // Manager of this org, Polish UI like the case.
    await loginAs(page, TENANT, 'manager', { locale: 'pl' });
    await expect(page).toHaveURL(/\/manage$/);

    // The case's entry point: the „Role” section of the manager panel.
    await page.locator('a[href="/manage/roles"]').first().click();
    await expect(page).toHaveURL(/\/manage\/roles$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Role', exact: true })).toBeVisible();

    // The org is on Launch, so the *old* gate would withhold every write here.
    const plan = await getData<PlanInfo>(page, '/api/v1/me/plan');
    expect(plan.key, 'the seeded organization plan').toBe('launch');

    // The gate is now the caller's permission: the admin role holds it.
    const permissions = await getData<{ permissions: Record<string, string | null> }>(
      page,
      '/api/v1/me/permissions',
    );
    expect(permissions.permissions['org.role.manage'], 'the admin holds the gate').toBe(
      'organization',
    );

    // No plan lock: „Nowa rola” and the write column are offered on Launch.
    await expect(page.getByText('Kreator ról nie jest dostępny w Twoim planie')).toHaveCount(0);
    const newRoleButton = page.getByRole('button', { name: 'Nowa rola', exact: true });
    await expect(newRoleButton).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Akcje', exact: true })).toBeVisible();

    // Step 1 of the case: create „Asystent” from the Assistant preset.
    await newRoleButton.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { level: 2, name: 'Utwórz rolę' })).toBeVisible();
    await dialog.getByLabel('Nazwa roli').fill(ROLE_NAME);
    await dialog.getByLabel('Opis (opcjonalny)').fill(ROLE_DESCRIPTION);
    await expect(
      dialog.getByRole('combobox', { name: 'Szablon startowy' }),
      'the create form offers the D17 templates',
    ).toBeVisible();
    await dialog.getByRole('combobox', { name: 'Szablon startowy' }).click();
    await page.getByRole('option', { name: 'Asystent', exact: true }).click();
    await dialog.getByRole('button', { name: 'Utwórz', exact: true }).click();

    await expect(
      page.locator('[data-sonner-toast]').filter({ hasText: 'Rola utworzona' }),
      'the role is created on Launch',
    ).toBeVisible();
    const createdRow = roleRow(page, ROLE_NAME);
    await expect(createdRow).toHaveCount(1);
    await expect(createdRow.getByText('Niestandardowa', { exact: true })).toBeVisible();

    // The assistant preset really applied: it carries the front-desk org keys and
    // never ownership (D16).
    const roles = await getData<OrgRoleRow[]>(page, '/api/v1/organization/roles');
    const created = roles.find((role) => role.name === ROLE_NAME);
    if (!created) throw new Error(`${CASE}: the created role is missing from the list`);
    expect(created.isSystem).toBe(false);
    expect(created.permissionCount, 'the preset wrote its rows').toBeGreaterThan(0);

    const detail = await getData<OrgRoleDetail>(page, `/api/v1/organization/roles/${created.id}`);
    expect(detail.permissions).toContainEqual({
      permissionName: 'org.member.manage',
      scope: 'organization',
    });
    expect(
      detail.permissions.some((permission) => permission.permissionName === 'org.admin'),
      'ownership is not grantable through a preset (D16)',
    ).toBe(false);

    // Editing is the same permission: rename and read it back.
    const update = await page.request.put(`/api/v1/organization/roles/${created.id}`, {
      data: { name: ROLE_NAME_EDITED },
    });
    expect(update.status(), 'PUT /organization/roles/:id on Launch').toBe(200);
    const afterUpdate = await getData<OrgRoleRow[]>(page, '/api/v1/organization/roles');
    expect(afterUpdate.find((role) => role.id === created.id)?.name).toBe(ROLE_NAME_EDITED);
    await page.reload();
    await expect(roleRow(page, ROLE_NAME_EDITED), 'the rename reached the page').toHaveCount(1);

    // ── A same-org member without the permission ────────────────────────────
    const teacherContext = await browser.newContext({
      baseURL: process.env.QA_APP_URL ?? 'http://localhost:3010',
    });
    try {
      const teacher = await teacherContext.newPage();
      await loginAs(teacher, TENANT, 'teacher', { locale: 'pl' });

      const teacherPermissions = await getData<{
        permissions: Record<string, string | null>;
      }>(teacher, '/api/v1/me/permissions');
      expect(
        teacherPermissions.permissions['org.role.manage'],
        'the teacher role does not hold the gate',
      ).toBeUndefined();

      // The persona route rule still keeps an educator out of /manage (AUT-17 owns
      // that surface), so no editor is rendered for this member.
      await teacher.goto('/manage/roles');
      await expect(teacher).toHaveURL(/\/edu(\/|$)/);
      await expect(teacher.getByRole('button', { name: 'Nowa rola', exact: true })).toHaveCount(0);

      // The permission, not the persona, is what the API enforces: the write paths
      // answer 403 for exactly the caller the editor is withheld from.
      const deniedCreate = await teacher.request.post('/api/v1/organization/roles', {
        data: { name: 'Asystent nauczyciela', description: null },
      });
      expect(deniedCreate.status(), 'POST without org.role.manage').toBe(403);
      expect(await deniedCreate.json()).toEqual({ success: false, error: 'FORBIDDEN' });

      const deniedDelete = await teacher.request.delete(`/api/v1/organization/roles/${created.id}`);
      expect(deniedDelete.status(), 'DELETE without org.role.manage').toBe(403);

      // The list itself stays readable for every org member (the members page and
      // the permission picker read it too).
      const teacherRoles = await getData<OrgRoleRow[]>(teacher, '/api/v1/organization/roles');
      expect(teacherRoles.map((role) => role.name)).toContain(ROLE_NAME_EDITED);
    } finally {
      await teacherContext.close();
    }

    // ── A manager-account-type member holding a custom role without the gate ──
    // The teacher above is out of /manage because of the persona rule, not the
    // permission, so it cannot show the permission-only deny. This member has the
    // manager account type and a custom role built from the Assistant preset: the
    // page is theirs, and only `org.role.manage` can withhold the write UI.
    const roleless = tenantUser(TENANT, 'roleless');
    const assign = await page.request.put('/api/v1/organization/members', {
      data: { targetUserId: roleless.id, newOrgRoleId: created.id },
    });
    expect(assign.status(), 'PUT /organization/members assigns the custom role').toBe(200);

    const rolelessContext = await browser.newContext({
      baseURL: process.env.QA_APP_URL ?? 'http://localhost:3010',
    });
    try {
      const noGatePage = await rolelessContext.newPage();
      await loginAs(noGatePage, TENANT, 'roleless', { locale: 'pl' });
      await expect(noGatePage).toHaveURL(/\/manage$/);

      const noGatePermissions = await getData<{
        permissions: Record<string, string | null>;
      }>(noGatePage, '/api/v1/me/permissions');
      expect(
        noGatePermissions.permissions['org.role.manage'],
        'the custom role does not hold the gate',
      ).toBeUndefined();

      // A manager reaches the page and reads the list...
      await noGatePage.goto('/manage/roles');
      await expect(noGatePage).toHaveURL(/\/manage\/roles$/);
      await expect(
        noGatePage.getByRole('heading', { level: 1, name: 'Role', exact: true }),
      ).toBeVisible();
      await expect(roleRow(noGatePage, ROLE_NAME_EDITED)).toHaveCount(1);

      // ...but the permission, not the account type, is what withholds the editor.
      await expect(
        noGatePage.getByRole('button', { name: 'Nowa rola', exact: true }),
        'no create control without org.role.manage',
      ).toHaveCount(0);
      await expect(
        noGatePage.getByRole('columnheader', { name: 'Akcje', exact: true }),
        'no actions column without org.role.manage',
      ).toHaveCount(0);

      const deniedManagerCreate = await noGatePage.request.post('/api/v1/organization/roles', {
        data: { name: 'Widmo', description: null },
      });
      expect(
        deniedManagerCreate.status(),
        'POST without org.role.manage from a manager account type',
      ).toBe(403);
      expect(await deniedManagerCreate.json()).toEqual({ success: false, error: 'FORBIDDEN' });
    } finally {
      await rolelessContext.close();
    }

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });
});
