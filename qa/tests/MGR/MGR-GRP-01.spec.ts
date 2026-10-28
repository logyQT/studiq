import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { tenantKey } from '#test/e2e/fixtures/ids';
import {
  buildAccount,
  createSeedDb,
  randomTag,
  seedTenantGraph,
  tenantId,
  type SeedAccount,
} from '#test/helpers/tenant-seed';

/**
 * MGR-GRP-01 — listing, creating, editing and deleting organization groups
 * (/manage/groups).
 *
 * Prerequisite (reconciled with the tenant seeder): a manager whose organization
 * already has two groups, one of them populated. The legacy manual seed
 * (`manager@dev.local`, password `pass`) is never used.
 *
 * Tenant: `tenantKey('qa/cases/MGR-GRP-01.md', 'MGR-GRP-01 groups CRUD', 'qa-shared')::<run suffix>`.
 * Every org/user/group id is `tenantId(key, entity)`, so a run is reproducible by
 * pinning `QA_RUN_SUFFIX`; by default the suffix is fresh, which gives each
 * independent run its own organization and groups.
 *
 * The spec seeds its own graph through the shared helpers
 * (`__tests__/helpers/tenant-seed.ts`): org + admin manager + teacher + student in
 * the default group `G1`, plus an empty second group `G2` — the case's „2 grupy”.
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
 *    the row (and the row in the API) is gone while the two seeded groups stay.
 */

const CASE_FILE = 'qa/cases/MGR-GRP-01.md';
const TITLE = 'MGR-GRP-01 groups CRUD';
const PROJECT = 'qa-shared';
const RUN_SUFFIX = process.env.QA_RUN_SUFFIX ?? `${Date.now().toString(36)}-${randomTag(4)}`;

/** Supabase local defaults (the service-role JWT is the public `supabase start` demo key). */
const LOCAL_SUPABASE_URL = 'http://localhost:54421';
const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  teacherCount: number;
  canManage: boolean;
}

interface CaseTenant {
  key: string;
  org: { id: string; name: string };
  manager: SeedAccount;
  /** Group every org gets; the manager teaches it and two members belong to it. */
  defaultGroup: { id: string; name: string };
  /** Second, empty group — the case's „(2 grupy)” prerequisite. */
  secondGroup: { id: string; name: string };
}

/**
 * Resolve the shared Supabase admin credentials. `QA_SUPABASE_*` wins; otherwise
 * the routine `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`, then the
 * worker's `qa/env.json`, then the shared local defaults.
 */
function resolveSupabase(): { url: string; serviceKey: string } {
  let fromEnvJson: string | undefined;
  try {
    const raw = readFileSync(join(process.cwd(), 'qa', 'env.json'), 'utf8');
    fromEnvJson = (JSON.parse(raw) as { supabaseUrl?: string }).supabaseUrl;
  } catch {
    // qa/env.json is worker-local and gitignored; absence is fine.
  }

  return {
    url:
      process.env.QA_SUPABASE_URL ??
      process.env.NEXT_PUBLIC_SUPABASE_URL ??
      fromEnvJson ??
      LOCAL_SUPABASE_URL,
    serviceKey:
      process.env.QA_SUPABASE_SERVICE_ROLE_KEY ??
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      LOCAL_SERVICE_ROLE_KEY,
  };
}

/** Seed the case's organization: admin manager + teacher + student, two groups. */
async function seedCaseTenant(): Promise<CaseTenant> {
  const key = `${tenantKey(CASE_FILE, TITLE, PROJECT)}::${RUN_SUFFIX}`;
  const org = { id: tenantId(key, 'org'), name: `qa-mgr-grp01-${RUN_SUFFIX}` };
  const manager = buildAccount(key, 'manager', 'manager', { name: 'QA manager' });
  const teacher = buildAccount(key, 'teacher', 'educator', { name: 'QA teacher' });
  const student = buildAccount(key, 'student', 'student', { name: 'QA student' });
  const defaultGroup = { id: tenantId(key, 'group:default'), name: 'G1', isDefault: true };
  const secondGroup = { id: tenantId(key, 'group:second'), name: 'G2', isDefault: false };

  const { url, serviceKey } = resolveSupabase();
  const db = createSeedDb({ url, serviceKey });

  const seeded = await seedTenantGraph(db, {
    key,
    org,
    defaultGroup,
    extraGroups: [secondGroup],
    owner: manager,
    members: [teacher, student],
    ownerOrgRole: 'admin',
  });

  return {
    key,
    org,
    manager: seeded.owner,
    defaultGroup: { id: defaultGroup.id, name: defaultGroup.name },
    secondGroup: { id: secondGroup.id, name: secondGroup.name },
  };
}

/**
 * Polish copy is asserted because the case quotes the Polish UI; the login helper
 * pins `NEXT_LOCALE=pl`, so a locale cookie left by an earlier case cannot change
 * the strings under test.
 */
async function pinPolish(page: Page, baseURL: string): Promise<void> {
  const { hostname } = new URL(baseURL);
  await page
    .context()
    .addCookies([{ name: 'NEXT_LOCALE', value: 'pl', domain: hostname, path: '/' }]);
}

/** Real login through the API, so the session cookie lives in the page context. */
async function loginAsManager(page: Page, tenant: CaseTenant, baseURL: string): Promise<void> {
  const response = await page.request.post('/api/v1/auth/login', {
    data: { email: tenant.manager.email, password: tenant.manager.password },
  });
  expect(response.status(), `login ${tenant.manager.email}`).toBe(200);
  await pinPolish(page, baseURL);
  await page.goto('/login');
  await expect(page).toHaveURL(/\/manage$/);
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
  let tenant: CaseTenant;

  test.beforeAll(async () => {
    tenant = await seedCaseTenant();
    console.log(`MGR-GRP-01 tenant key: ${tenant.key} (org ${tenant.org.id})`);
  });

  test('lists, creates, edits and deletes a group', async ({ page, baseURL }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const origin = baseURL ?? 'http://localhost:3010';

    await loginAsManager(page, tenant, origin);

    // The dashboard settles the active organization first; the case's own entry
    // point is the „Grupy” sidebar item.
    await expect(
      page.locator('[data-slot="sidebar-header"] [data-sidebar="menu-button"]'),
    ).toContainText(tenant.org.name);
    await page.locator('a[href="/manage/groups"]').first().click();
    await expect(page).toHaveURL(/\/manage\/groups$/);
    await expect(page.getByRole('heading', { name: 'Grupy', exact: true })).toBeVisible();

    // 1. The table: Nazwa / Członkowie / Nauczyciele / Akcje, and the case's two
    // pre-existing groups with their real counts (G1: 2 members + the manager as
    // teacher; G2: empty).
    for (const column of ['Nazwa', 'Członkowie', 'Nauczyciele', 'Akcje']) {
      await expect(
        page.getByRole('columnheader', { name: column, exact: true }),
        `column ${column}`,
      ).toBeVisible();
    }

    const existing = groupRow(page, tenant.defaultGroup.name);
    await expect(existing).toBeVisible();
    await expect(existing.getByRole('cell').nth(1)).toHaveText('3');
    await expect(existing.getByRole('cell').nth(2)).toHaveText('1');

    const emptyExisting = groupRow(page, tenant.secondGroup.name);
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
      'the two seeded groups are untouched',
    ).toEqual([tenant.defaultGroup.id, tenant.secondGroup.id].sort());
    expect(afterDelete.find((group) => group.id === tenant.defaultGroup.id)?.memberCount).toBe(3);

    expect(pageErrors, 'uncaught page errors during groups CRUD').toEqual([]);
  });
});
