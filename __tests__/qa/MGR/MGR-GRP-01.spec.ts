import { expect, test, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * MGR-GRP-01 — listing, creating, editing and deleting organization groups
 * (/manage/groups).
 *
 * Prerequisite (reconciled with the tenant seeder): a manager whose organization
 * already has two groups, one of them populated. The legacy manual seed
 * (`manager@dev.local`, password `pass`) is never used.
 *
 * Tenant: the case's profile (`__tests__/qa/profiles/MGR-GRP-01.json`), seeded once
 * before Playwright starts by `bun scripts/qa-tenant.ts --all --run <suffix>`:
 * the `content` profile with an explicit roster and two declarative groups —
 *
 * - the manager as the org `admin` (the only role the case uses) and a teacher +
 *   student as org members;
 * - `G1`, the default group, where the manager is the teacher and the teacher +
 *   student are members (renders 3 / 1);
 * - `G2`, seeded empty (renders 0 / 0) — the case's „2 grupy”.
 *
 * All ids derive from `tenantKey('qa/cases/MGR-GRP-01.md', …)` + the batch run
 * suffix, so an independent run gets a brand-new organization and groups. The
 * spec never seeds: it reads the tenant with `loadTenant('MGR-GRP-01')`, and
 * „Grupa C” is created through the product's own UI in the test — content, not
 * tenant shape.
 *
 * Nothing global is written (no settings, flags, plans or platform rows) and no
 * other case's tenant is touched.
 *
 * Acceptance points (confirmed on the shared app during the walk):
 * 1. The table lists groups with the columns Nazwa / Członkowie / Nauczyciele /
 *    Akcje, with real member and teacher counts.
 * 2. „Nowa grupa” + name/description + „Utwórz” shows „Grupa utworzona” and the
 *    new row appears with its description and zero counts.
 * 3. „Edytuj” opens the form pre-filled; saving a new name shows „Grupa
 *    zaktualizowana” and renames the row in place (description preserved).
 * 4. „Usuń” opens „Usunąć grupę?” with the warning that every member is removed
 *    from it; cancelling keeps the group, confirming shows „Grupa usunięta” and
 *    the row (and the row in the API) is gone while the two pre-existing groups stay.
 */

const CASE = 'MGR-GRP-01';
const TENANT: QaTenant = loadTenant(CASE);

/** The second, empty group declared in the case profile (`groups: ["G1", "G2"]`). */
const SECOND_GROUP = 'G2';

interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  teacherCount: number;
  canManage: boolean;
}

/** The rows the groups page renders, read through the same API the page calls. */
async function listGroups(page: Page): Promise<GroupRow[]> {
  const response = await page.request.get('/api/v1/organization/groups');
  expect(response.status(), 'GET /api/v1/organization/groups').toBe(200);
  const body = (await response.json()) as { success: boolean; data: GroupRow[] };
  expect(body.success).toBe(true);
  return body.data;
}

/** The table row for an exact group name (descriptions and sr-labels excluded). */
function groupRow(page: Page, name: string) {
  return page.getByRole('row').filter({ has: page.getByText(name, { exact: true }) });
}

test.describe('@case:MGR-GRP-01 @area:MGR @prio:P1 organization groups CRUD', () => {
  test('lists, creates, edits and deletes a group', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const org = TENANT.org;
    const defaultGroup = TENANT.group;
    if (!org || !defaultGroup) {
      throw new Error(`tenant ${CASE} needs the content profile (org + default group)`);
    }

    // Polish copy is asserted because the case quotes the Polish UI; `loginAs`
    // pins `NEXT_LOCALE=pl`, so a locale cookie left by an earlier case cannot
    // change the strings under test. It also seeds the tenant's `active_org_id`,
    // the cookie the app writes when an organization is created or switched.
    await loginAs(page, TENANT, 'manager', { locale: 'pl', waitFor: /\/manage$/ });

    // The second group is declared in the profile; resolve its id once so the
    // final assertion can prove the delete touched only the group created in
    // the walk.
    const secondGroup = (await listGroups(page)).find((group) => group.name === SECOND_GROUP);
    if (!secondGroup) throw new Error(`tenant ${CASE} has no seeded ${SECOND_GROUP} group`);

    // The case's own entry point is the „Grupy” sidebar item; the dashboard
    // settles the active organization first.
    await expect(
      page.locator('[data-slot="sidebar-header"] [data-sidebar="menu-button"]'),
    ).toContainText(org.name);
    await page.locator('a[href="/manage/groups"]').first().click();
    await expect(page).toHaveURL(/\/manage\/groups$/);
    await expect(page.getByRole('heading', { name: 'Grupy', exact: true })).toBeVisible();

    // 1. The table: Nazwa / Członkowie / Nauczyciele / Akcje, and the case's two
    // pre-existing groups with their real counts (G1: 2 members + the manager as
    // teacher; the second group: empty).
    for (const column of ['Nazwa', 'Członkowie', 'Nauczyciele', 'Akcje']) {
      await expect(
        page.getByRole('columnheader', { name: column, exact: true }),
        `column ${column}`,
      ).toBeVisible();
    }

    const existing = groupRow(page, defaultGroup.name);
    await expect(existing).toBeVisible();
    await expect(existing.getByRole('cell').nth(1)).toHaveText('3');
    await expect(existing.getByRole('cell').nth(2)).toHaveText('1');

    const emptyExisting = groupRow(page, secondGroup.name);
    await expect(emptyExisting).toBeVisible();
    await expect(emptyExisting.getByRole('cell').nth(1)).toHaveText('0');
    await expect(emptyExisting.getByRole('cell').nth(2)).toHaveText('0');

    // 2. Create „Grupa C” with a description.
    await page.getByRole('button', { name: 'Nowa grupa' }).click();
    const createDialog = page.getByRole('dialog');
    await expect(createDialog).toBeVisible();
    await expect(createDialog.getByText('Utwórz grupę', { exact: true })).toBeVisible();
    const nameInput = createDialog.getByRole('textbox').nth(0);
    const descriptionInput = createDialog.getByRole('textbox').nth(1);
    await expect(nameInput).toHaveValue('');
    await expect(descriptionInput).toHaveValue('');
    await nameInput.fill('Grupa C');
    await descriptionInput.fill('Opis grupy C');
    await createDialog.getByRole('button', { name: 'Utwórz' }).click();

    await expect(page.getByText('Grupa utworzona', { exact: true })).toBeVisible();
    await expect(createDialog).toBeHidden();

    const created = groupRow(page, 'Grupa C');
    await expect(created).toBeVisible();
    await expect(created.getByRole('cell').nth(0)).toContainText('Opis grupy C');
    await expect(created.getByRole('cell').nth(1)).toHaveText('0');
    await expect(created.getByRole('cell').nth(2)).toHaveText('0');

    const afterCreate = await listGroups(page);
    const createdRow = afterCreate.find((group) => group.name === 'Grupa C');
    if (!createdRow) throw new Error('created group is missing from GET /organization/groups');
    expect(createdRow.description, 'description stored by the API').toBe('Opis grupy C');
    expect(createdRow.memberCount).toBe(0);
    expect(createdRow.teacherCount).toBe(0);
    expect(createdRow.canManage).toBe(true);

    // 3. Edit the name — the form opens pre-filled, the description survives.
    await created.getByRole('button', { name: 'Edytuj grupę Grupa C' }).click();
    const editDialog = page.getByRole('dialog');
    await expect(editDialog).toBeVisible();
    await expect(editDialog.getByText('Edytuj grupę', { exact: true })).toBeVisible();
    await expect(editDialog.getByRole('textbox').nth(0)).toHaveValue('Grupa C');
    await expect(editDialog.getByRole('textbox').nth(1)).toHaveValue('Opis grupy C');
    await editDialog.getByRole('textbox').nth(0).fill('Grupa C2');
    await editDialog.getByRole('button', { name: 'Zapisz' }).click();

    await expect(page.getByText('Grupa zaktualizowana', { exact: true })).toBeVisible();
    await expect(editDialog).toBeHidden();

    const renamed = groupRow(page, 'Grupa C2');
    await expect(renamed).toBeVisible();
    await expect(renamed.getByRole('cell').nth(0)).toContainText('Opis grupy C');
    await expect(created).toHaveCount(0);

    const afterEdit = await listGroups(page);
    const renamedRow = afterEdit.find((group) => group.id === createdRow.id);
    if (!renamedRow) throw new Error('edited group is missing from GET /organization/groups');
    expect(renamedRow.name, 'renamed in place').toBe('Grupa C2');
    expect(renamedRow.description, 'description preserved by the edit').toBe('Opis grupy C');
    expect(afterEdit.filter((group) => group.name === 'Grupa C2')).toHaveLength(1);

    // 4. Delete — the window warns that the members are removed from the group.
    await renamed.getByRole('button', { name: 'Usuń grupę Grupa C2' }).click();
    const deleteDialog = page.getByRole('dialog');
    await expect(deleteDialog).toBeVisible();
    await expect(deleteDialog.getByText('Usunąć grupę?', { exact: true })).toBeVisible();
    await expect(
      deleteDialog.getByText(
        'Spowoduje to usunięcie wszystkich członków z tej grupy. Tej operacji nie można cofnąć.',
        { exact: true },
      ),
    ).toBeVisible();

    // Cancelling must not delete anything.
    await deleteDialog.getByRole('button', { name: 'Anuluj' }).click();
    await expect(deleteDialog).toBeHidden();
    await expect(renamed).toBeVisible();
    expect(
      (await listGroups(page)).some((group) => group.id === renamedRow.id),
      'group survives the cancelled delete',
    ).toBe(true);

    // Confirming deletes it.
    await renamed.getByRole('button', { name: 'Usuń grupę Grupa C2' }).click();
    await expect(deleteDialog).toBeVisible();
    await deleteDialog.getByRole('button', { name: 'Usuń', exact: true }).click();

    await expect(page.getByText('Grupa usunięta', { exact: true })).toBeVisible();
    await expect(deleteDialog).toBeHidden();
    await expect(renamed).toHaveCount(0);

    // The row is gone for real, and only the created group was touched.
    const afterDelete = await listGroups(page);
    expect(
      afterDelete.filter((group) => group.id === renamedRow.id),
      'deleted group is gone from the API',
    ).toEqual([]);
    expect(
      afterDelete.map((group) => group.id).sort(),
      'the two pre-existing groups are untouched',
    ).toEqual([defaultGroup.id, secondGroup.id].sort());
    expect(afterDelete.find((group) => group.id === defaultGroup.id)?.memberCount).toBe(3);

    expect(pageErrors, 'uncaught page errors during groups CRUD').toEqual([]);
  });
});
