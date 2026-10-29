import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

/**
 * EDU-GRP-03 — a teacher edits and deletes their own group, and cannot touch a
 * colleague's group (`/edu/groups`).
 *
 * Case steps: (1) edit the name and description, then delete the group; (2) try
 * to edit a group created by another user.
 * Expected: the delete window reads „Usunąć grupę?” / „Spowoduje to usunięcie
 * wszystkich członków z tej grupy…”, and the foreign group shows „Grupa utworzona
 * przez kogoś innego — nie możesz jej edytować” with its actions disabled.
 *
 * Tenant (deterministic, one per independent run):
 *
 *   bun scripts/qa-tenant.ts EDU-GRP-03 --fresh
 *
 * The legacy seed named the people T1/T2 and the groups O1G1/O1G2. In the tenant
 * model `users.teacher` is T1 (org role `teacher`, so `group.manage` is
 * entitled) and `users.teacher2` is T2, the colleague whose group T1 must not be
 * able to edit. The case's prerequisite („Grupa utworzona przez T1”) is created
 * through the product API as T1, and T2's group through the product API as T2, so
 * nothing is written outside this tenant. `org-limit` is the seeded shape that
 * gives the organization two teachers with the real org `teacher` role (the
 * `content` profile only seeds one teacher, as an org `member`).
 *
 * The two groups are removed at the start of the run when a previous run left
 * them behind: the organization is on Launch (3 groups) and holds one seeded
 * group, so the spec creates exactly two more. That keeps a retry against the
 * same tenant inside the group limit, and the run ends with its own group
 * deleted.
 */

const CASE = 'EDU-GRP-03';
const GROUPS_URL = '/api/v1/organization/groups';

/** Polish copy from `ManageGroupsPage` (`apps/web/src/i18n/messages/pl.json`). */
const COPY = {
  title: 'Grupy',
  columns: ['Nazwa', 'Członkowie', 'Nauczyciele', 'Akcje'],
  editTitle: 'Edytuj grupę',
  save: 'Zapisz',
  updated: 'Grupa zaktualizowana',
  deleteTitle: 'Usunąć grupę?',
  deleteDescription:
    'Spowoduje to usunięcie wszystkich członków z tej grupy. Tej operacji nie można cofnąć.',
  cancel: 'Anuluj',
  delete: 'Usuń',
  deleted: 'Grupa usunięta',
  manageMembers: 'Zarządzaj członkami',
  notOwned: 'Grupa utworzona przez kogoś innego — nie możesz jej edytować',
} as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface GroupSummary {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  memberCount: number;
  teacherCount: number;
  canManage: boolean;
}

async function listGroups(api: APIRequestContext): Promise<GroupSummary[]> {
  const res = await api.get(GROUPS_URL);
  expect(res.status(), `GET ${GROUPS_URL} → ${await res.text()}`).toBe(200);
  const body = (await res.json()) as ApiEnvelope<GroupSummary[]>;
  expect(body.success, `GET ${GROUPS_URL} success`).toBe(true);
  return body.data;
}

/**
 * Remove this spec's own groups if a previous run left them behind (e.g. a run
 * that failed between the edit and the delete). Only rows whose name matches
 * exactly are touched, so the seeded group and any other case's data stay out of
 * reach.
 */
async function removeGroupsNamed(api: APIRequestContext, names: readonly string[]): Promise<void> {
  for (const group of await listGroups(api)) {
    if (!names.includes(group.name)) continue;
    const res = await api.delete(`${GROUPS_URL}/${group.id}`);
    expect(res.ok(), `DELETE ${group.name} (${group.id}) → ${await res.text()}`).toBe(true);
  }
}

/** Create a group through the same endpoint the „Nowa grupa” dialog calls. */
async function createGroup(
  api: APIRequestContext,
  name: string,
  description?: string,
): Promise<GroupSummary> {
  const res = await api.post(GROUPS_URL, {
    data: { name, ...(description ? { description } : {}) },
  });
  expect(res.status(), `POST ${GROUPS_URL} (${name}) → ${await res.text()}`).toBe(201);
  const body = (await res.json()) as ApiEnvelope<
    Omit<GroupSummary, 'memberCount' | 'teacherCount' | 'canManage'>
  >;
  expect(body.success, `POST ${GROUPS_URL} success`).toBe(true);
  return { ...body.data, memberCount: 0, teacherCount: 0, canManage: true };
}

/** The table row whose name cell is exactly `name` (the description follows it). */
function groupRow(page: Page, name: string): Locator {
  return page.locator('table tbody tr').filter({ has: page.getByText(name, { exact: true }) });
}

/** Sign a second API context in as the colleague (T2) inside the same org. */
async function signInColleague(
  playwright: typeof import('playwright-core'),
  baseURL: string,
  email: string,
  password: string,
  orgId: string,
): Promise<APIRequestContext> {
  const api = await playwright.request.newContext({ baseURL });
  const login = await api.post('/api/v1/auth/login', { data: { email, password } });
  expect(login.status(), `login ${email}`).toBe(200);
  // The app only writes `active_org_id` on an org switch (the fixture seeds the
  // cookie for the page); the API context needs the same tenant scope.
  const switched = await api.post('/api/v1/me/orgs/switch', { data: { orgId } });
  expect(switched.ok(), `switch ${email} to ${orgId}`).toBe(true);
  return api;
}

test.describe('@case:EDU-GRP-03 @area:EDU @prio:P2 teacher edits and deletes own group', () => {
  test("edits and deletes T1's group and cannot edit T2's group", async ({
    page,
    baseURL,
    playwright,
  }) => {
    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the org-limit tenant profile`).toBe('org-limit');
    expect(tenant.org, `${CASE} needs the seeded organization`).toBeTruthy();

    const teacher = tenant.users.teacher;
    const colleague = tenant.users.teacher2;
    expect(teacher, `${CASE} needs the seeded T1 account`).toBeTruthy();
    expect(colleague, `${CASE} needs the seeded T2 account`).toBeTruthy();

    // Deterministic per tenant, so a re-run against the same seeded tenant finds
    // (and removes) its own leftovers instead of being blocked by the group limit.
    const run = tenant.runSuffix ?? tenant.key.slice(-8);
    const ownName = `Grupa T1 ${run}`;
    const editedName = `Grupa T1 edycja ${run}`;
    const ownDescription = `Opis T1 ${run}`;
    const editedDescription = `Nowy opis T1 ${run}`;
    const foreignName = `Grupa T2 ${run}`;

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const origin = baseURL ?? 'http://localhost:3010';

    // T1 is the teacher under test; the page context carries T1's session.
    await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu(\/|$)/ });

    const colleagueApi = await signInColleague(
      playwright,
      origin,
      colleague!.email,
      colleague!.password,
      tenant.org!.id,
    );

    try {
      // --- Prerequisites, as the case states them ---------------------------
      // „Grupa utworzona przez T1” and „grupa utworzona przez innego użytkownika”.
      await removeGroupsNamed(page.request, [ownName, editedName]);
      await removeGroupsNamed(colleagueApi, [foreignName]);

      const foreignGroup = await createGroup(colleagueApi, foreignName);
      const ownGroup = await createGroup(page.request, ownName, ownDescription);

      // --- Step 2 premise: the colleague's group is not T1's ----------------
      const foreign = (await listGroups(page.request)).find(
        (group) => group.id === foreignGroup.id,
      );
      expect(foreign, 'T2 group is visible to T1').toBeTruthy();
      expect(foreign?.canManage, "T1 may not manage T2's group").toBe(false);

      // --- Steps 1 + 2: /edu/groups ----------------------------------------
      await page.goto('/edu/groups');
      await expect(page).toHaveURL(/\/edu\/groups$/, { timeout: 20_000 });
      await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

      await expect(page.getByRole('heading', { name: COPY.title, exact: true })).toBeVisible();
      for (const column of COPY.columns) {
        await expect(
          page.getByRole('columnheader', { name: column, exact: true }),
          `column ${column}`,
        ).toBeVisible();
      }

      // Own group: every action is available, because T1 created it.
      const ownRow = groupRow(page, ownName);
      await expect(ownRow, "T1's own group is listed").toHaveCount(1);
      await expect(ownRow.locator('td').nth(0)).toContainText(ownDescription);
      await expect(
        ownRow.getByRole('button', { name: `Edytuj grupę ${ownName}` }),
        'own group is editable',
      ).toBeVisible();
      await expect(
        ownRow.getByRole('button', { name: `Usuń grupę ${ownName}` }),
        'own group is deletable',
      ).toBeVisible();
      await expect(ownRow.getByRole('button', { name: COPY.manageMembers })).toBeVisible();
      await expect(ownRow.locator('span[title]'), 'own group has no lock').toHaveCount(0);

      // Colleague's group: actions disabled and the reason is shown on the lock.
      const foreignRow = groupRow(page, foreignName);
      await expect(foreignRow, "T2's group is listed").toHaveCount(1);
      await expect(foreignRow.getByRole('button', { name: /Edytuj grupę/ })).toHaveCount(0);
      await expect(foreignRow.getByRole('button', { name: /Usuń grupę/ })).toHaveCount(0);
      await expect(foreignRow.getByRole('button', { name: COPY.manageMembers })).toHaveCount(0);
      await expect(
        foreignRow.locator('span[title]'),
        'the lock carries the not-owned explanation',
      ).toHaveAttribute('title', COPY.notOwned);

      // --- Step 1a: edit the name and the description ----------------------
      await ownRow.getByRole('button', { name: `Edytuj grupę ${ownName}` }).click();
      const editDialog = page.getByRole('dialog');
      await expect(editDialog).toBeVisible();
      await expect(editDialog.getByText(COPY.editTitle, { exact: true })).toBeVisible();

      const nameInput = editDialog.getByRole('textbox').nth(0);
      const descriptionInput = editDialog.getByRole('textbox').nth(1);
      await expect(nameInput, 'the form is pre-filled with the name').toHaveValue(ownName);
      await expect(descriptionInput, 'the form is pre-filled with the description').toHaveValue(
        ownDescription,
      );

      await nameInput.fill(editedName);
      await descriptionInput.fill(editedDescription);
      await editDialog.getByRole('button', { name: COPY.save, exact: true }).click();

      await expect(
        page.locator('[data-sonner-toast]').filter({ hasText: COPY.updated }),
        'success toast after saving',
      ).toBeVisible();
      await expect(editDialog, 'the dialog closes after saving').toBeHidden();

      const renamedRow = groupRow(page, editedName);
      await expect(renamedRow, 'the row is renamed in place').toHaveCount(1);
      await expect(renamedRow.locator('td').nth(0), 'the new description is shown').toContainText(
        editedDescription,
      );
      await expect(ownRow, 'the old name is gone').toHaveCount(0);

      const afterEdit = (await listGroups(page.request)).find((group) => group.id === ownGroup.id);
      expect(afterEdit?.name, 'API keeps the renamed group').toBe(editedName);
      expect(afterEdit?.description, 'API keeps the edited description').toBe(editedDescription);
      expect(afterEdit?.canManage, 'the group is still T1-owned').toBe(true);

      // --- Step 1b: delete — the window carries the warning ----------------
      await renamedRow.getByRole('button', { name: `Usuń grupę ${editedName}` }).click();
      const deleteDialog = page.getByRole('dialog');
      await expect(deleteDialog).toBeVisible();
      await expect(deleteDialog.getByText(COPY.deleteTitle, { exact: true })).toBeVisible();
      await expect(
        deleteDialog.getByText(COPY.deleteDescription, { exact: true }),
        'the members warning from the case',
      ).toBeVisible();

      // Cancelling keeps the group.
      await deleteDialog.getByRole('button', { name: COPY.cancel, exact: true }).click();
      await expect(deleteDialog).toBeHidden();
      await expect(renamedRow, 'the cancelled delete keeps the row').toBeVisible();
      expect(
        (await listGroups(page.request)).some((group) => group.id === ownGroup.id),
        'the cancelled delete keeps the group in the API',
      ).toBe(true);

      // Confirming removes it.
      await renamedRow.getByRole('button', { name: `Usuń grupę ${editedName}` }).click();
      await expect(deleteDialog).toBeVisible();
      await deleteDialog.getByRole('button', { name: COPY.delete, exact: true }).click();

      await expect(
        page.locator('[data-sonner-toast]').filter({ hasText: COPY.deleted }),
        'success toast after deleting',
      ).toBeVisible();
      await expect(deleteDialog, 'the dialog closes after deleting').toBeHidden();
      await expect(renamedRow, 'the deleted row is gone').toHaveCount(0);

      const afterDelete = await listGroups(page.request);
      expect(
        afterDelete.some((group) => group.id === ownGroup.id),
        'the deleted group is gone from the API',
      ).toBe(false);

      // --- Step 2: the colleague's group is untouched, and the API agrees ---
      await expect(groupRow(page, foreignName), "T2's row survives T1's delete").toHaveCount(1);

      const forbiddenRename = await page.request.put(`${GROUPS_URL}/${foreignGroup.id}`, {
        data: { name: `Hijack ${run}` },
      });
      expect(forbiddenRename.status(), "T1 cannot rename T2's group").toBe(403);
      const forbiddenDelete = await page.request.delete(`${GROUPS_URL}/${foreignGroup.id}`);
      expect(forbiddenDelete.status(), "T1 cannot delete T2's group").toBe(403);

      const finalList = await listGroups(page.request);
      const untouched = finalList.find((group) => group.id === foreignGroup.id);
      expect(untouched?.name, "T2's group name is unchanged").toBe(foreignName);
      expect(untouched?.description ?? null, "T2's group description is unchanged").toBe(null);
      expect(untouched?.canManage, "T1 still may not manage T2's group").toBe(false);

      expect(pageErrors, 'uncaught page errors').toEqual([]);
    } finally {
      await colleagueApi.dispose();
    }
  });
});
