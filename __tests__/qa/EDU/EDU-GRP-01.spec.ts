import { expect, test, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

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
 * The case's prerequisite is „T1 (plan Lite – group.manage)”: an educator whose
 * resolved feature set contains `group.manage`, which is what shows the „Grupa”
 * sidebar item, the „Nowa grupa” button and the actions column. In the tenant model
 * that entitlement comes from the org role: the org trigger seeds
 * `org_role_features` per role, so only an educator with the org `teacher` role has
 * `group.manage` (`member` gets flashcards/quiz/ai.chat/documents only). The
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
 *    and adds the row with its description and 0 members / 0 teachers.
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
  canManage: boolean;
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

    // Prerequisite: the org `teacher` role resolves `group.manage`, which is what
    // renders the write controls. A member-role educator would get a read-only list.
    const features = await page.request.get('/api/v1/features/me');
    expect(features.status(), 'GET /api/v1/features/me').toBe(200);
    const enabled = ((await features.json()) as ApiEnvelope<{ features: string[] }>).data.features;
    expect(enabled, 'the educator is entitled to group management').toContain('group.manage');

    // A retried run shares the tenant: remove its leftover group first, both to keep
    // the row count deterministic and to stay under the plan's three-group limit.
    const seededIds: string[] = [];
    for (const group of await listGroups(page)) {
      if (group.name !== GROUP_NAME) {
        seededIds.push(group.id);
        continue;
      }
      expect(group.canManage, 'the leftover group belongs to this tenant’s educator').toBe(true);
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
      await expect(created.getByRole('cell').nth(1), 'members of a new group').toHaveText('0');
      await expect(created.getByRole('cell').nth(2), 'teachers of a new group').toHaveText('0');

      // 4. Persisted for this organization, authored by the educator — its actions
      //    column offers edit/delete instead of the read-only lock.
      const stored = (await listGroups(page)).filter((group) => group.name === GROUP_NAME);
      expect(stored, 'exactly one „Grupa testowa” in the API').toHaveLength(1);
      createdId = stored[0].id;
      expect(stored[0].description, 'description stored by the API').toBe(GROUP_DESCRIPTION);
      expect(stored[0].memberCount).toBe(0);
      expect(stored[0].teacherCount).toBe(0);
      expect(stored[0].canManage, 'the educator owns the group').toBe(true);

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
          .sort(),
        'only the case’s own group was added',
      ).toEqual(seededIds.sort());

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
