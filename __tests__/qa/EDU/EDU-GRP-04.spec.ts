import { expect, type Page } from '@playwright/test';
import { loadTenant, loginAs, test, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * EDU-GRP-04 — the organization plan's group limit (Launch: 3 groups) is
 * enforced when a teacher creates groups from `/edu/groups`.
 *
 * Case steps: with the organization already at two groups, create the third
 * one (it must appear) and then try a fourth (it must be refused with
 * `USAGE_LIMIT_EXCEEDED` and a readable message).
 *
 * Tenant (deterministic, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts EDU-GRP-04 --fresh
 *
 * `__tests__/qa/profiles/EDU-GRP-04.json` declares `{"profile":"org-limit","plan":"launch"}`:
 * an educator account with the organization `teacher` role (the only role that
 * gets `group.manage`, hence „Nowa grupa”), in a Launch organization
 * (`plan_limits.max_groups = 3`) with one seeded default group `G1`. Every id is
 * `tenantKey('qa/cases/EDU-GRP-04.md', 'EDU-GRP-04#<run>', 'qa-shared')` +
 * `tenantId`, so a run is reproducible by pinning `QA_RUN_SUFFIX`.
 *
 * The case's legacy seed (`teacher1@dev.local`, `pass`) is never used, and
 * nothing global is read or written: no admin setting, feature flag, plan row,
 * platform stat or singleton.
 *
 * Acceptance points (confirmed on the shared app during the walk):
 * 1. The organization's own plan governs the counter: the teacher's personal
 *    Lite plan allows `max_groups = 1`, yet the second and third groups are
 *    created — `POST /api/v1/organization/groups` answers 201 and the row
 *    appears with the „Grupa utworzona” toast.
 * 2. The fourth attempt is refused by the Launch limit:
 *    `POST /api/v1/organization/groups` → 429 with
 *    `{"success":false,"error":"USAGE_LIMIT_EXCEEDED"}`, the page shows the
 *    readable „Nie udało się utworzyć grupy” toast, the dialog stays open with
 *    the typed name and no group is added.
 *
 * Re-run safety: CI seeds one tenant per spec and retries against it, so the
 * spec deletes only the groups it names at the start of every run before it
 * counts the baseline.
 */

const CASE = 'EDU-GRP-04';

/** The groups this spec creates; the fourth one is deliberately never created. */
const GROUPS = {
  second: 'Grupa QA 2',
  third: 'Grupa QA 3',
  refused: 'Grupa QA 4',
} as const;

/** Polish copy from `ManageGroupsPage` (pl.json). */
const COPY = {
  pageTitle: 'Grupy',
  columns: ['Nazwa', 'Członkowie', 'Nauczyciele', 'Akcje'],
  newGroup: 'Nowa grupa',
  createTitle: 'Utwórz grupę',
  create: 'Utwórz',
  created: 'Grupa utworzona',
  createFailed: 'Nie udało się utworzyć grupy',
} as const;

interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  teacherCount: number;
  canManage: boolean;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: string;
}

/** The rows the groups page renders, read through the same API the page calls. */
async function listGroups(page: Page): Promise<GroupRow[]> {
  const response = await page.request.get('/api/v1/organization/groups');
  expect(response.status(), 'GET /api/v1/organization/groups').toBe(200);
  const body = (await response.json()) as ApiEnvelope<GroupRow[]>;
  expect(body.success, JSON.stringify(body)).toBe(true);
  return body.data;
}

/** The table row for an exact group name (descriptions and sr-labels excluded). */
function groupRow(page: Page, name: string) {
  return page.getByRole('row').filter({ has: page.getByText(name, { exact: true }) });
}

/** Open `/edu/groups` the way a teacher does: dashboard first, then the sidebar. */
async function openGroups(page: Page, tenant: QaTenant): Promise<void> {
  await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu$/ });

  // The dashboard settles the active organization before the groups page loads;
  // a bare deep link right after an API login can answer 403 until it does.
  await expect(
    page.locator('[data-slot="sidebar-header"] [data-sidebar="menu-button"]'),
  ).toContainText(tenant.org!.name);
  await page.locator('a[href="/edu/groups"]').first().click();
  await expect(page).toHaveURL(/\/edu\/groups$/);
  await expect(page.getByRole('heading', { name: COPY.pageTitle, exact: true })).toBeVisible();
}

/** Fill the „Utwórz grupę” dialog and submit; returns the POST response. */
async function createGroup(page: Page, name: string) {
  await page.getByRole('button', { name: COPY.newGroup }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(COPY.createTitle, { exact: true })).toBeVisible();

  const nameInput = dialog.getByRole('textbox').nth(0);
  await expect(nameInput).toHaveValue('');
  await nameInput.fill(name);

  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/organization/groups') &&
      response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: COPY.create, exact: true }).click();

  return { dialog, response: await responsePromise };
}

test.describe('EDU-GRP-04 — organization group limit (Launch: 3 groups)', () => {
  test('creates the third group and refuses the fourth with a plan limit', async ({ page }) => {
    const tenant = loadTenant(CASE);
    expect(tenant.profile, 'EDU-GRP-04 needs the org-limit tenant profile').toBe('org-limit');
    expect(tenant.plan, 'EDU-GRP-04 needs the Launch plan (max_groups = 3)').toBe('launch');
    if (!tenant.org || !tenant.group) {
      throw new Error(
        'EDU-GRP-04 fixture incomplete: run `bun scripts/qa-tenant.ts EDU-GRP-04 --fresh`',
      );
    }

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await openGroups(page, tenant);

    // The case's section: the table lists groups by name with real counts.
    for (const column of COPY.columns) {
      await expect(page.getByRole('columnheader', { name: column, exact: true })).toBeVisible();
    }

    // Re-run safety: remove only this spec's own groups (the teacher created
    // them, so `canManage` is true) before counting the baseline.
    const leftovers = (await listGroups(page)).filter((group) =>
      Object.values(GROUPS).includes(group.name as (typeof GROUPS)[keyof typeof GROUPS]),
    );
    for (const leftover of leftovers) {
      expect(leftover.canManage, `leftover ${leftover.name} must be the teacher's own group`).toBe(
        true,
      );
      const deleted = await page.request.delete(`/api/v1/organization/groups/${leftover.id}`);
      expect(deleted.status(), `cleanup DELETE ${leftover.name}`).toBe(200);
    }

    const baseline = await listGroups(page);
    expect(
      baseline.map((group) => group.name),
      'the tenant starts from its one seeded group',
    ).toEqual([tenant.group.name]);

    // 1. The third group (second one created by the teacher) is allowed even
    // though the teacher's personal Lite plan allows only one group.
    const second = await createGroup(page, GROUPS.second);
    expect(second.response.status(), await second.response.text()).toBe(201);
    const secondBody = (await second.response.json()) as ApiEnvelope<{ name: string }>;
    expect(secondBody.success, JSON.stringify(secondBody)).toBe(true);
    expect(secondBody.data.name).toBe(GROUPS.second);
    await expect(second.dialog).toBeHidden();
    await expect(
      page.locator('[data-sonner-toast]').filter({ hasText: COPY.created }).first(),
    ).toBeVisible();
    const secondRow = groupRow(page, GROUPS.second);
    await expect(secondRow).toBeVisible();
    await expect(secondRow.getByRole('cell').nth(1)).toHaveText('0');
    await expect(secondRow.getByRole('cell').nth(2)).toHaveText('0');

    const third = await createGroup(page, GROUPS.third);
    expect(third.response.status(), await third.response.text()).toBe(201);
    await expect(third.dialog).toBeHidden();
    await expect(groupRow(page, GROUPS.third)).toBeVisible();

    const atCapacity = await listGroups(page);
    expect(
      atCapacity.map((group) => group.name),
      'the organization now holds exactly three groups',
    ).toEqual([tenant.group.name, GROUPS.second, GROUPS.third]);

    // 2. The fourth group is refused by the Launch plan limit.
    const refused = await createGroup(page, GROUPS.refused);
    expect(refused.response.status(), 'the fourth group must be refused by the plan').toBe(429);
    const refusedBody = (await refused.response.json()) as ApiEnvelope<unknown>;
    expect(refusedBody.success).toBe(false);
    expect(refusedBody.error).toBe('USAGE_LIMIT_EXCEEDED');

    // Readable feedback, and the dialog keeps the attempt so nothing is lost.
    await expect(
      page.locator('[data-sonner-toast]').filter({ hasText: COPY.createFailed }).first(),
    ).toBeVisible();
    await expect(refused.dialog).toBeVisible();
    await expect(refused.dialog.getByRole('textbox').nth(0)).toHaveValue(GROUPS.refused);
    await expect(groupRow(page, GROUPS.refused)).toHaveCount(0);

    // The refusal did not create anything: the organization still has 3 groups.
    const afterRefusal = await listGroups(page);
    expect(afterRefusal.map((group) => group.name)).toEqual([
      tenant.group.name,
      GROUPS.second,
      GROUPS.third,
    ]);
    expect(
      afterRefusal.filter((group) => group.name === GROUPS.refused),
      'the refused group is not stored',
    ).toEqual([]);

    expect(pageErrors, 'uncaught page errors while creating groups').toEqual([]);
  });
});
