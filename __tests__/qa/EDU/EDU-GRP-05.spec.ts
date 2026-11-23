import { isPermissionCatalogKey, PERMISSIONS, type PermissionScope } from '@studiq/authz';
import { expect, test, type Page } from '@playwright/test';
import { json } from '#test/helpers/json';
import { loadTenant, loginAs, type QaTenant } from '#test/qa/fixtures/tenant';

/**
 * EDU-GRP-05 — an educator without `group.manage` („Brak funkcji group.manage”).
 *
 * Case prerequisite (verbatim): „Użyj konta bez funkcji group.manage (konto bez tej
 * funkcji).” The suite uses that second option, so no
 * global admin setting, feature flag or user override is touched.
 *
 * Tenant (deterministic, `content` profile, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts EDU-GRP-05 --fresh
 *
 * `group.manage` is a permission (ADR-0015 §4.1): the org `member` role holds `group.read`
 * at `group` scope and no `group.manage`, `group.member.manage` or `group.invite`, so an
 * educator on that role is exactly „konto bez tej funkcji”. The `content` profile's
 * default educator is a real Teacher since 2b-3, so this case declares its own roster
 * (`members` in `__tests__/qa/profiles/EDU-GRP-05.json`: an `admin` manager, a `member`
 * educator and a `member` student) instead of leaning on a default that now carries
 * `group.manage`; its manager (org `admin`) holds every `group.*` key at `organization` and
 * is the contrast that the controls are permission-driven rather than missing for
 * everyone. Every id comes from
 * `tenantKey('qa/cases/EDU-GRP-05.md', 'EDU-GRP-05#<suffix>', 'qa-shared')` +
 * `tenantId(key, entity)`; the spec reads them through `loadTenant('EDU-GRP-05')`.
 *
 * Acceptance points, as the case text settles them (ADR-0015 §4.3, §7.1):
 * 1. The „Grupy” entry is in the `/edu` sidebar — a holder of `group.read` always sees the
 *    list they may read; the educator's row is at `group` scope, so before 2b-2 the nav's
 *    scoped check hid a page the role could reach. Reloading keeps it there.
 * 2. `group.read` opens `/edu/groups`, and the list renders: the columns, the seeded group
 *    with its real counts and the „not owned” lock.
 * 3. No manage control renders anywhere on the page — create, edit, delete, members — and
 *    every group write is rejected with `403` + `FORBIDDEN` (`POST` create, `PUT`/`DELETE`
 *    of the group, `PUT` of its members), leaving the group untouched.
 * 4. A caller whose map has no `group.read` gets no entry: the gate is the key, not the
 *    page being busy.
 *
 * The spec never creates or mutates anything: the write attempts are all expected to be
 * refused, so re-runs on one seeded tenant (CI `--retries=2`) start from the same state.
 */

const CASE = 'EDU-GRP-05';

/** Polish copy from `ManageGroupsPage` (pl.json) and the sidebar label. */
const COPY = {
  title: 'Grupy',
  newGroup: 'Nowa grupa',
  notOwned: 'Grupa utworzona przez kogoś innego — nie możesz jej edytować',
  edit: 'Edytuj grupę',
  remove: 'Usuń grupę',
} as const;

const GROUPS_URL = '/api/v1/organization/groups';

/** Members/teachers of the `content` tenant's default group `G1`. */
const SEEDED_GROUP_COUNTS = { members: '3', teachers: '1' } as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: string;
}

interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  teacherCount: number;
  manageVia: 'group.manage' | 'group.member.manage' | null;
}

interface GroupMemberRow {
  userId: string;
  role: 'teacher' | 'member';
}

interface OrgMemberRow {
  id: string;
  orgRoleId: string;
}

interface OrgRoleDetail {
  permissions: { permissionName: string; scope: PermissionScope }[];
}

/** `GET` the group list as the signed-in educator and unwrap the envelope. */
async function listGroups(page: Page): Promise<GroupRow[]> {
  const response = await page.request.get(GROUPS_URL);
  const body = await json<ApiEnvelope<GroupRow[]>>(response);
  expect(response.status(), `GET ${GROUPS_URL} → ${JSON.stringify(body)}`).toBe(200);
  expect(body.success).toBe(true);
  return body.data;
}

/** The table row for an exact group name (descriptions and sr-labels excluded). */
function groupRow(page: Page, name: string) {
  return page.getByRole('row').filter({ has: page.getByText(name, { exact: true }) });
}

test.describe('@case:EDU-GRP-05 @area:EDU @prio:P2 educator without group.manage', () => {
  test('shows the Grupy entry, a read-only list, and rejects every group write with 403', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const tenant: QaTenant = loadTenant(CASE);
    expect(tenant.profile, 'EDU-GRP-05 needs the content tenant profile').toBe('content');
    expect(tenant.org, 'the tenant has an organization').toBeTruthy();
    expect(tenant.group, 'the tenant has a default group').toBeTruthy();

    await loginAs(page, tenant, 'teacher', { locale: 'pl' });
    expect(new URL(page.url()).pathname, 'educator lands on /edu').toBe('/edu');

    // Prerequisite: this educator is „konto bez tej funkcji”. `/me/permissions` carries
    // the resolved scope map (ADR-0015 §6.3): the read key present proves the map
    // resolved, `group.manage` absent is the missing function. Read by key, never by
    // `toHaveProperty('group.manage')`: the matcher splits on the dot, so the
    // negative form passes against a map that DOES carry the key.
    const permissions = await page.request.get('/api/v1/me/permissions');
    expect(permissions.status(), 'GET /api/v1/me/permissions').toBe(200);
    const scopes = (await json<ApiEnvelope<{ permissions: Record<string, string> }>>(permissions))
      .data.permissions;
    expect(Object.keys(scopes), 'the educator holds no group.manage').not.toContain('group.manage');
    expect(Object.keys(scopes), 'the permission map resolved').toContain('group.read');

    const sidebar = page.locator('[data-slot="sidebar"]');

    // 1. The holder of `group.read` sees the entry the role's key opens. The rest of the
    //    nav is asserted too, so a sidebar that failed to render cannot pass this.
    await expect(sidebar.getByRole('link', { name: 'Talie', exact: true })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: COPY.title, exact: true })).toBeVisible();
    await expect(sidebar.locator('a[href="/edu/groups"]')).toHaveCount(1);

    // Case step 1: refresh the teacher panel — the entry stays there, and the link itself
    // is the way in (case step 2 opens the page by hand, below).
    await page.reload();
    await expect(sidebar.getByRole('link', { name: 'Talie', exact: true })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: COPY.title, exact: true })).toBeVisible();
    await sidebar.locator('a[href="/edu/groups"]').click();

    // 2. The list renders, read-only: the rows and the summary line are there, and no
    //    control that would write is offered anywhere on the page.
    await expect(page).toHaveURL(/\/edu\/groups$/);
    await expect(page.getByRole('heading', { name: COPY.title, exact: true })).toBeVisible();
    // The table offers the class and nothing to do with it: no row-level manage
    // control renders for a caller whose `manageVia` is `null`.
    await expect(
      page.getByRole('button', { name: /^(Zarządzaj członkami|Edytuj grupę|Usuń grupę)/ }),
      'no manage control on any row',
    ).toHaveCount(0);

    const seeded = groupRow(page, tenant.group!.name);
    await expect(seeded, 'the tenant’s own group is listed').toBeVisible();
    await expect(seeded.getByRole('cell').nth(1), 'members column').toHaveText(
      SEEDED_GROUP_COUNTS.members,
    );
    await expect(seeded.getByRole('cell').nth(2), 'teachers column').toHaveText(
      SEEDED_GROUP_COUNTS.teachers,
    );
    await expect(seeded.getByTitle(COPY.notOwned), 'the read-only lock badge').toBeVisible();
    await expect(
      page.getByRole('button', { name: /^(Nowa grupa|Edytuj grupę|Usuń grupę)/ }),
      'no create/edit/delete control on the whole page',
    ).toHaveCount(0);

    // 3. Writes are rejected at the API, not just hidden in the UI. Every body is
    //    well-formed and would succeed for an entitled user, so the 403 is the feature
    //    gate and not a validation error.
    const before = await listGroups(page);
    const stored = before.find((group) => group.id === tenant.group!.id);
    expect(stored, 'the seeded group is visible to its member').toBeTruthy();
    // The API's own answer for the row: no key lets this caller manage the class.
    expect(stored!.manageVia, 'the educator manages neither the class nor its roster').toBeNull();

    const membersResponse = await page.request.get(`${GROUPS_URL}/${tenant.group!.id}/members`);
    expect(membersResponse.status(), 'GET group members').toBe(200);
    const currentMembers = (await json<ApiEnvelope<GroupMemberRow[]>>(membersResponse)).data;
    expect(currentMembers.length, 'the seeded group has members').toBeGreaterThan(0);

    const writeAttempts = [
      {
        label: 'POST create',
        method: 'POST',
        url: GROUPS_URL,
        data: { name: 'Nieautoryzowana grupa', description: 'Próba zapisu bez group.manage' },
      },
      {
        label: 'PUT update',
        method: 'PUT',
        url: `${GROUPS_URL}/${tenant.group!.id}`,
        data: { name: 'Przejęta grupa' },
      },
      {
        label: 'DELETE group',
        method: 'DELETE',
        url: `${GROUPS_URL}/${tenant.group!.id}`,
        data: undefined,
      },
      {
        label: 'PUT members',
        method: 'PUT',
        url: `${GROUPS_URL}/${tenant.group!.id}/members`,
        // The group's current membership: even a missing gate would leave it unchanged.
        data: { members: currentMembers },
      },
    ] as const;

    for (const attempt of writeAttempts) {
      const response = await page.request.fetch(attempt.url, {
        method: attempt.method,
        data: attempt.data,
      });
      const body = await json<{ success: boolean; error?: string }>(response);
      expect(response.status(), `${attempt.label} must be rejected`).toBe(403);
      expect(response.headers()['x-error-code'], `${attempt.label} error code`).toBe('FORBIDDEN');
      expect(body, `${attempt.label} response body`).toEqual({
        success: false,
        error: 'FORBIDDEN',
      });
    }

    // „brak niezabezpieczonych akcji”: the refused writes changed nothing.
    const after = await listGroups(page);
    expect(
      after.map((group) => ({
        id: group.id,
        name: group.name,
        memberCount: group.memberCount,
        teacherCount: group.teacherCount,
      })),
      'the refused writes left the group list untouched',
    ).toEqual(
      before.map((group) => ({
        id: group.id,
        name: group.name,
        memberCount: group.memberCount,
        teacherCount: group.teacherCount,
      })),
    );

    expect(pageErrors, 'uncaught page errors on /edu/groups').toEqual([]);

    // 4. The gate is the key, not the page: a role without `group.read` gets no entry and
    //    no list. The tenant's own org `member` role is saved down to its content keys —
    //    the mover is the manager (org `admin`, which may edit any role) and the target is
    //    the role the educator holds. The role is restored before the manager phase, so the
    //    tenant is left exactly as seeded.
    await page.request.post('/api/v1/auth/logout');
    await loginAs(page, tenant, 'manager', { locale: 'pl' });

    const members = (
      await json<ApiEnvelope<OrgMemberRow[]>>(
        await page.request.get('/api/v1/organization/members'),
      )
    ).data;
    const educator = members.find((member) => member.id === tenant.users.teacher?.id);
    expect(educator, 'the educator is an org member').toBeTruthy();
    const memberRoleId = educator!.orgRoleId;
    const role = (
      await json<ApiEnvelope<OrgRoleDetail>>(
        await page.request.get(`/api/v1/organization/roles/${memberRoleId}`),
      )
    ).data;
    // The editor replaces the role's whole set (D24), so the payload is one entry per
    // catalog key: the role's stored rows as they are, every other key revoked.
    const seededGrant = Object.keys(PERMISSIONS)
      .filter(isPermissionCatalogKey)
      .map((key) => ({
        permissionName: key,
        scope: role.permissions.find((grant) => grant.permissionName === key)?.scope ?? null,
      }));

    async function saveRolePermissions(entries: typeof seededGrant) {
      const saved = await page.request.put(
        `/api/v1/organization/roles/${memberRoleId}/permissions`,
        {
          data: { permissions: entries },
        },
      );
      expect(saved.status(), `PUT role permissions → ${await saved.text()}`).toBe(200);
    }

    try {
      await saveRolePermissions(
        seededGrant.map((grant) =>
          grant.permissionName.startsWith('group.') ? { ...grant, scope: null } : grant,
        ),
      );

      await page.request.post('/api/v1/auth/logout');
      await loginAs(page, tenant, 'teacher', { locale: 'pl' });

      const withoutRead = await page.request.get('/api/v1/me/permissions');
      const scopesAfterSave = (
        await json<ApiEnvelope<{ permissions: Record<string, string> }>>(withoutRead)
      ).data.permissions;
      expect(Object.keys(scopesAfterSave), 'the saved role carries no group key').not.toContain(
        'group.read',
      );

      await expect(sidebar.getByRole('link', { name: 'Talie', exact: true })).toBeVisible();
      await expect(
        sidebar.getByRole('link', { name: COPY.title, exact: true }),
        'a role without group.read gets no Grupy entry',
      ).toHaveCount(0);
      await expect(sidebar.locator('a[href="/edu/groups"]')).toHaveCount(0);

      const refusedList = await page.request.get(GROUPS_URL);
      expect(refusedList.status(), 'GET groups without group.read').toBe(403);
    } finally {
      await page.request.post('/api/v1/auth/logout');
      await loginAs(page, tenant, 'manager', { locale: 'pl' });
      await saveRolePermissions(seededGrant);
    }

    // Adjacent regression: the same tenant's manager (org `admin`, i.e. every `group.*`
    // key at `organization`) still gets the „Grupy” entry and the per-row actions, so the
    // missing controls above are the permission gate and not a broken nav/translation.
    // (`create` is a known QA-tenant gap — the `content` profile's manager gets no create
    // control, EDU-GRP-01 is red for it — recorded in the ledger, not asserted here.)
    await page.request.post('/api/v1/auth/logout');
    await loginAs(page, tenant, 'manager', { locale: 'pl' });
    expect(new URL(page.url()).pathname, 'manager lands on /manage').toBe('/manage');

    const managerSidebar = page.locator('[data-slot="sidebar"]');
    await expect(
      managerSidebar.getByRole('link', { name: COPY.title, exact: true }),
      'an entitled manager still sees the Grupy entry',
    ).toBeVisible();
    await expect(managerSidebar.locator('a[href="/manage/groups"]')).toHaveCount(1);

    await page.goto('/manage/groups');
    await expect(page).toHaveURL(/\/manage\/groups$/);
    await expect(
      page.getByRole('button', { name: `Edytuj grupę ${tenant.group!.name}` }),
      'an entitled manager still gets the per-row manage actions',
    ).toBeVisible();
  });
});
