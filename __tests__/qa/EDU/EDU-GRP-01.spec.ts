import { expect, test, type Page } from '@playwright/test';
import { json } from '#test/helpers/json';
import { loadTenant, loginAs, type QaTenant } from '#test/qa/fixtures/tenant';

/**
 * EDU-GRP-01 — the educator's group list and „Nowa grupa” (`/edu/groups`).
 *
 * Case steps: open `/edu/groups`, click „Nowa grupa”, fill name „Grupa testowa” plus
 * a description, save.
 *
 * Tenant (deterministic, `org-limit` profile, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts EDU-GRP-01 --fresh
 *
 * The case's prerequisite is „T1 (plan Lite – group.manage)”: an educator who may
 * manage classes, which is what shows the „Grupa” sidebar item, the „Nowa grupa”
 * button and the actions column. Since 2b-2 that is the `group.*` permission on the
 * active org's role (ADR-0015 §4.3), not the `group.manage` entitlement: the org
 * `teacher` role holds every group key at `group` scope, so its educator manages the
 * classes they teach — and, since 2b-2, creates their own (§10: a class is the
 * teaching surface; the creator becomes its teacher). The
 * `org-limit` profile is the seeder's shape with a seeded org-`teacher` educator
 * (admin + two teachers + one member, default group `G1`), so the case runs without
 * editing the shared seeder. Every id comes from
 * `tenantKey('qa/cases/EDU-GRP-01.md', 'EDU-GRP-01#<suffix>', 'qa-shared')` +
 * `tenantId(key, entity)`; the spec reads them through `loadTenant('EDU-GRP-01')`.
 * Nothing global is written (no setting, flag, plan or singleton row) and no other
 * case's tenant is touched.
 *
 * Acceptance points (confirmed on the shared app during the walk):
 * 1. `/edu/groups` shows the „Grupy” list with the columns Nazwa / Członkowie /
 *    Nauczyciele / Akcje, including the tenant's seeded group with its real counts.
 * 2. „Nowa grupa” opens „Utwórz grupę” with empty Nazwa/Opis fields.
 * 3. Saving „Grupa testowa” with a description shows the toast „Grupa utworzona”
 *    and adds the row with its description and 1 member / 1 teacher — its author,
 *    whom the create enrols as the class's teacher (`memberCount` counts the whole
 *    roster, teachers included).
 * 4. The created group is persisted for this tenant's organization (the API the page
 *    calls lists exactly one row with that name) and is manageable by its author.
 *
 * The spec deletes the group it creates (and any same-named leftover of a retried
 * run) through the same API: the organization plan allows three groups, and CI
 * re-runs one spec up to four times on one seeded tenant.
 */

const CASE = 'EDU-GRP-01';

/** Polish copy from `ManageGroupsPage` (pl.json). */
const COPY = {
  title: 'Grupy',
  newGroup: 'Nowa grupa',
  createTitle: 'Utwórz grupę',
  nameLabel: 'Nazwa',
  descriptionLabel: 'Opis',
  create: 'Utwórz',
  created: 'Grupa utworzona',
  columns: ['Nazwa', 'Członkowie', 'Nauczyciele', 'Akcje'],
} as const;

const GROUP_NAME = 'Grupa testowa';
const GROUP_DESCRIPTION = 'Opis grupy testowej';
const GROUPS_URL = '/api/v1/organization/groups';

/** Members/teachers of the org-limit tenant's default group `G1`. */
const SEEDED_GROUP_COUNTS = { members: '4', teachers: '1' } as const;

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
  /** The key the API resolved for this row — what each control is gated on. */
  manageVia: 'group.manage' | 'group.member.manage' | null;
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

test.describe('@case:EDU-GRP-01 @area:EDU @prio:P2 teacher group list and creation', () => {
  test('lists the organization groups and creates „Grupa testowa”', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const tenant: QaTenant = loadTenant(CASE);
    expect(tenant.profile, 'EDU-GRP-01 needs the org-limit tenant profile').toBe('org-limit');
    expect(tenant.org, 'the tenant has an organization').toBeTruthy();
    expect(tenant.group, 'the tenant has a default group').toBeTruthy();

    await loginAs(page, tenant, 'teacher', { locale: 'pl' });
    expect(new URL(page.url()).pathname, 'educator lands on /edu').toBe('/edu');

    // Prerequisite: the org `teacher` role holds the group keys, which is what
    // renders the list and its write controls. A member-role educator would get a
    // read-only list. The keys contain dots, so read them as object keys:
    // `toHaveProperty('group.manage')` splits on the dot and looks for a nested
    // `group.manage` object, which never matches this flat map.
    const permissions = await page.request.get('/api/v1/permissions/me');
    expect(permissions.status(), 'GET /api/v1/permissions/me').toBe(200);
    const scopes = (await json<ApiEnvelope<{ permissions: Record<string, string> }>>(permissions))
      .data.permissions;
    expect(Object.keys(scopes), 'the educator may manage classes').toContain('group.manage');
    expect(scopes['group.manage'], 'at the org (group) scope').toBe('group');

    // A retried run shares the tenant: remove its leftover group first, both to keep
    // the row count deterministic and to stay under the plan's three-group limit.
    const seededIds: string[] = [];
    for (const group of await listGroups(page)) {
      if (group.name !== GROUP_NAME) {
        seededIds.push(group.id);
        continue;
      }
      expect(
        group.manageVia,
        'the leftover group belongs to this tenant’s educator',
      ).not.toBeNull();
      const deleted = await page.request.delete(`${GROUPS_URL}/${group.id}`);
      expect(deleted.status(), `DELETE ${GROUPS_URL}/${group.id}`).toBe(200);
    }

    let createdId: string | undefined;
    try {
      // 1. Open the case's page. The „Grupy” item is the sidebar entry point for
      //    an entitled educator.
      await page.locator(`a[href="/edu/groups"]`).first().waitFor();
      await page.goto('/edu/groups');
      await expect(page).toHaveURL(/\/edu\/groups$/);
      await expect(page.getByRole('heading', { name: COPY.title, exact: true })).toBeVisible();

      for (const column of COPY.columns) {
        await expect(
          page.getByRole('columnheader', { name: column, exact: true }),
          `column ${column}`,
        ).toBeVisible();
      }

      const seeded = groupRow(page, tenant.group!.name);
      await expect(seeded, 'the tenant’s own group is listed').toBeVisible();
      await expect(seeded.getByRole('cell').nth(1), 'members column').toHaveText(
        SEEDED_GROUP_COUNTS.members,
      );
      await expect(seeded.getByRole('cell').nth(2), 'teachers column').toHaveText(
        SEEDED_GROUP_COUNTS.teachers,
      );

      // 2. „Nowa grupa” opens the create form with empty fields.
      await page.getByRole('button', { name: COPY.newGroup }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(COPY.createTitle, { exact: true })).toBeVisible();
      await expect(dialog.getByText(COPY.nameLabel, { exact: true })).toBeVisible();
      await expect(dialog.getByText(COPY.descriptionLabel, { exact: true })).toBeVisible();
      const nameInput = dialog.getByRole('textbox').nth(0);
      const descriptionInput = dialog.getByRole('textbox').nth(1);
      await expect(nameInput).toHaveValue('');
      await expect(descriptionInput).toHaveValue('');

      // 3. Save the case's group.
      await nameInput.fill(GROUP_NAME);
      await descriptionInput.fill(GROUP_DESCRIPTION);
      await dialog.getByRole('button', { name: COPY.create }).click();

      await expect(page.getByText(COPY.created, { exact: true })).toBeVisible();
      await expect(dialog).toBeHidden();

      const created = groupRow(page, GROUP_NAME);
      await expect(created, 'the new group is listed exactly once').toHaveCount(1);
      await expect(created.getByRole('cell').nth(0)).toContainText(GROUP_DESCRIPTION);
      await expect(
        created.getByRole('cell').nth(1),
        'members of a new group — its author',
      ).toHaveText('1');
      await expect(
        created.getByRole('cell').nth(2),
        'the author is the new group’s teacher',
      ).toHaveText('1');

      // 4. Persisted for this organization, authored by the educator — its actions
      //    column offers edit/delete instead of the read-only lock.
      const stored = (await listGroups(page)).filter((group) => group.name === GROUP_NAME);
      expect(stored, 'exactly one „Grupa testowa” in the API').toHaveLength(1);
      const [storedGroup] = stored;
      if (!storedGroup) throw new Error(`${CASE} the created group is not in the API list`);
      createdId = storedGroup.id;
      expect(storedGroup.description, 'description stored by the API').toBe(GROUP_DESCRIPTION);
      expect(storedGroup.memberCount, 'the roster holds its author').toBe(1);
      expect(storedGroup.teacherCount, 'the create enrols its author as teacher').toBe(1);
      expect(
        storedGroup.manageVia,
        'the educator may still manage the class it made',
      ).not.toBeNull();

      await expect(
        created.getByRole('button', { name: `Edytuj grupę ${GROUP_NAME}` }),
        'the author may edit the group',
      ).toBeVisible();
      await expect(
        created.getByRole('button', { name: `Usuń grupę ${GROUP_NAME}` }),
        'the author may delete the group',
      ).toBeVisible();

      // The seeded groups were not touched by the creation.
      const after = await listGroups(page);
      expect(
        after
          .map((group) => group.id)
          .filter((id) => seededIds.includes(id))
          .toSorted(),
        'only the case’s own group was added',
      ).toEqual(seededIds.toSorted());

      expect(pageErrors, 'uncaught page errors on /edu/groups').toEqual([]);
    } finally {
      // Leave the tenant as it was found, so the next retry/run starts from one
      // seeded group and the plan's group limit stays free.
      if (createdId) {
        const deleted = await page.request.delete(`${GROUPS_URL}/${createdId}`);
        expect(deleted.status(), 'cleanup of the created group').toBe(200);
      }
    }
  });
});
