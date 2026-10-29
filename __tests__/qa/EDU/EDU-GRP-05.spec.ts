import { expect, test, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * EDU-GRP-05 — an educator without `group.manage` („Brak funkcji group.manage”).
 *
 * Case prerequisite (verbatim): „Wyłącz funkcję group.manage dla T1 w panelu admina
 * (ADM-OVR) lub użyj konta bez tej funkcji.” The suite takes the second option, so no
 * global admin setting, feature flag or user override is touched.
 *
 * Tenant (deterministic, `content` profile, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts EDU-GRP-05 --fresh
 *
 * `group.manage` is an org-role entitlement: the org trigger seeds `org_role_features`
 * per role, and the `member` role gets only flashcards/quiz/ai.chat/documents/branding.
 * The `content` profile's educator is an org `member`, i.e. exactly „konto bez tej
 * funkcji”; its manager (org `admin`) keeps the entitlement and is used as the contrast
 * that the nav filter is role-driven rather than broken for everyone. Every id comes from
 * `tenantKey('qa/cases/EDU-GRP-05.md', 'EDU-GRP-05#<suffix>', 'qa-shared')` +
 * `tenantId(key, entity)`; the spec reads them through `loadTenant('EDU-GRP-05')`.
 *
 * Acceptance points (confirmed on the shared app during the walk):
 * 1. The „Grupy” entry is absent from the `/edu` sidebar — before and after a reload —
 *    while the rest of the educator nav is still there.
 * 2. `/edu/groups` stays reachable and renders a read-only list: the seeded group with its
 *    real counts and the „not owned” lock, but no create/edit/delete/member controls.
 * 3. Every group write is rejected with `403` + `FORBIDDEN` (`POST` create, `PUT`/`DELETE`
 *    of the group, `PUT` of its members) and leaves the group untouched.
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
  canManage: boolean;
}

interface GroupMemberRow {
  userId: string;
  role: 'teacher' | 'member';
}

/** `GET` the group list as the signed-in educator and unwrap the envelope. */
async function listGroups(page: Page): Promise<GroupRow[]> {
  const response = await page.request.get(GROUPS_URL);
  const body = (await response.json()) as ApiEnvelope<GroupRow[]>;
  expect(response.status(), `GET ${GROUPS_URL} → ${JSON.stringify(body)}`).toBe(200);
  expect(body.success).toBe(true);
  return body.data;
}

/** The table row for an exact group name (descriptions and sr-labels excluded). */
function groupRow(page: Page, name: string) {
  return page.getByRole('row').filter({ has: page.getByText(name, { exact: true }) });
}

test.describe('@case:EDU-GRP-05 @area:EDU @prio:P2 educator without group.manage', () => {
  test('hides the Grupy menu entry and rejects every group write with 403', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const tenant: QaTenant = loadTenant(CASE);
    expect(tenant.profile, 'EDU-GRP-05 needs the content tenant profile').toBe('content');
    expect(tenant.org, 'the tenant has an organization').toBeTruthy();
    expect(tenant.group, 'the tenant has a default group').toBeTruthy();

    await loginAs(page, tenant, 'teacher', { locale: 'pl' });
    expect(new URL(page.url()).pathname, 'educator lands on /edu').toBe('/edu');

    // Prerequisite: this educator is „konto bez tej funkcji”. `/features/me` resolving
    // other keys proves the answer is a real feature set, not a failed request.
    const features = await page.request.get('/api/v1/features/me');
    expect(features.status(), 'GET /api/v1/features/me').toBe(200);
    const enabled = ((await features.json()) as ApiEnvelope<{ features: string[] }>).data.features;
    expect(enabled, 'the educator is not entitled to group management').not.toContain(
      'group.manage',
    );
    expect(enabled, 'the feature resolution is not empty').toContain('flashcards');

    const sidebar = page.locator('[data-slot="sidebar"]');

    // 1. The menu has no „Grupy” entry, and the rest of the nav is intact — an empty or
    //    broken sidebar must not make this assertion pass for the wrong reason.
    await expect(sidebar.getByRole('link', { name: 'Talie', exact: true })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: COPY.title, exact: true })).toHaveCount(0);
    await expect(sidebar.locator('a[href="/edu/groups"]')).toHaveCount(0);

    // Case step 1: refresh the teacher panel — the entry stays gone.
    await page.reload();
    await expect(sidebar.getByRole('link', { name: 'Talie', exact: true })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: COPY.title, exact: true })).toHaveCount(0);
    await expect(sidebar.locator('a[href="/edu/groups"]')).toHaveCount(0);

    // 2. Case step 2: open `/edu/groups` manually. The route stays reachable but is
    //    read-only — no write control is exposed anywhere on the page.
    await page.goto('/edu/groups');
    await expect(page).toHaveURL(/\/edu\/groups$/);
    await expect(page.getByRole('heading', { name: COPY.title, exact: true })).toBeVisible();

    await expect(page.getByRole('button', { name: COPY.newGroup })).toHaveCount(0);

    const seeded = groupRow(page, tenant.group!.name);
    await expect(seeded, 'the tenant’s own group is listed').toBeVisible();
    await expect(seeded.getByRole('cell').nth(1), 'members column').toHaveText(
      SEEDED_GROUP_COUNTS.members,
    );
    await expect(seeded.getByRole('cell').nth(2), 'teachers column').toHaveText(
      SEEDED_GROUP_COUNTS.teachers,
    );
    await expect(seeded.getByTitle(COPY.notOwned), 'the read-only lock badge').toBeVisible();
    await expect(seeded.getByRole('button', { name: COPY.edit })).toHaveCount(0);
    await expect(seeded.getByRole('button', { name: COPY.remove })).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /^(Edytuj grupę|Usuń grupę)/ }),
      'no edit/delete control on the whole page',
    ).toHaveCount(0);

    // 3. Writes are rejected at the API, not just hidden in the UI. Every body is
    //    well-formed and would succeed for an entitled user, so the 403 is the feature
    //    gate and not a validation error.
    const before = await listGroups(page);
    const stored = before.find((group) => group.id === tenant.group!.id);
    expect(stored, 'the seeded group is visible to its member').toBeTruthy();
    expect(stored!.canManage, 'the educator does not own the group').toBe(false);

    const membersResponse = await page.request.get(`${GROUPS_URL}/${tenant.group!.id}/members`);
    expect(membersResponse.status(), 'GET group members').toBe(200);
    const currentMembers = ((await membersResponse.json()) as ApiEnvelope<GroupMemberRow[]>).data;
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
      const body = (await response.json()) as { success: boolean; error?: string };
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

    // Adjacent regression: the same tenant's manager (org `admin`, i.e. `group.manage`
    // present) still gets the „Grupy” entry and the create action, so the missing entry
    // above is the feature gate and not a broken nav/translation.
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
      page.getByRole('button', { name: COPY.newGroup }),
      'an entitled manager still gets the create action',
    ).toBeVisible();
  });
});
