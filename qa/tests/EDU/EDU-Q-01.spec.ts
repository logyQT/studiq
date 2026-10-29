import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';
import { tenantId } from '#test/helpers/tenant-seed';

/**
 * EDU-Q-01 — creating a question bank for a group (/edu/questions → /app/questions).
 *
 * Case (verbatim → tenant model): T1 at WSB Merito clicks „Nowy bank”, names it
 * „Fizyka” (description optional), sets visibility „Grupy” → O1G1, saves. Then the
 * student in that group sees the bank through ``/app/questions`` as read-only
 * („Podgląd banku”), a student outside the group does not see it, and the teacher's
 * list offers the „Wszystkie / Moje” scope plus a group multi-select — with no
 * „Grupy” scope. The case's legacy accounts (`teacher1@dev.local`, `student1..3`,
 * password `pass`) are never used.
 *
 * Tenant: the case's own declarative shape in
 * `qa/tests/profiles/EDU-Q-01.json`, seeded once before Playwright starts
 * (`bun scripts/qa-tenant.ts --all --run <suffix>`) and read through
 * `loadTenant(CASE)` — the spec never creates accounts, orgs or groups at runtime:
 *   - `teacher` — educator and org role `teacher` (so it holds
 *     `question_bank.create` and `group.manage`); it leads both groups;
 *   - `studentIn` — org member and member of the default group `G1` (the case's
 *     student1);
 *   - `studentOut` — org member of `G2` only (the case's „student spoza grupy”);
 *   - `groups: ["G1", "G2"]` — `G1` is the default group (`O1G1`), `G2` exists so
 *     a member of the same organization is demonstrably outside the share and the
 *     group multi-select has more than one option.
 *
 * The seeder enrols every member in the default group and leaves `G2` without a
 * teacher, so the two group rosters the case needs — `G1` = teacher + student1,
 * `G2` = teacher + the student outside the group — are written once in
 * `test.beforeAll` through the product's own roster endpoint (the same write
 * `/manage/groups` performs): tenant-local and idempotent. `G2`'s id is the
 * deterministic `tenantId(key, 'group:2')` the declarative `groups` field assigns.
 *
 * Nothing global is read or written: no admin setting, feature flag, plan,
 * platform stat or singleton row, and no other worker's tenant.
 *
 * Acceptance points (walked on the shared app, worker qa-env-4, before writing):
 * 1. „Nowy bank” → name „Fizyka” → „Grupy” → `G1` → „Utwórz” answers „Bank pytań
 *    utworzony”; the bank is stored `visibility: 'group'` with exactly `[G1]`, and
 *    its card carries the `G1` badge plus „Zarządzaj” for its author.
 * 2. The `G1` student sees the card in ``/app/questions`` with the `G1` badge and
 *    „Podgląd banku” (never „Zarządzaj”); the detail page shows the read-only
 *    notice „Podgląd banku. Pytania może dodawać i zmieniać tylko jego autor lub
 *    nauczyciel.” and offers no „Utwórz pytanie”.
 * 3. The `G2` student's list does not contain the bank and
 *    `GET /api/v1/questions/banks/:id` answers 404 — a group share does not leak
 *    across groups of the same organization.
 * 4. The teacher's toolbar has exactly two scope options, „Wszystkie” and „Moje”
 *    (no „Grupy”, no „Udostępnione”), plus a group multi-select with the „Dowolna
 *    grupa” placeholder and the „Moje grupy” quick action. Selecting `G1` narrows
 *    the list to the `G1` bank, „Moje grupy” selects `G1` + `G2` (hiding the
 *    ungrouped personal bank), and the legacy `groupFilter` query parameter is
 *    rejected with 422 instead of silently changing the scope.
 */

const CASE = 'EDU-Q-01';

const BANKS_URL = '/api/v1/questions/banks';

/** Polish copy the case quotes, as the current product renders it. */
const COPY = {
  newBank: 'Nowy bank',
  createTitle: 'Nowy bank',
  namePlaceholder: 'np. Biologia Egzamin',
  descriptionPlaceholder: 'Opcjonalny opis...',
  visibilityLabel: 'Widoczność',
  visibilityPersonal: 'Tylko ja',
  visibilityGroup: 'Grupy',
  groupsPlaceholder: 'Wybierz grupy...',
  create: 'Utwórz',
  created: 'Bank pytań utworzony',
  manage: 'Zarządzaj',
  viewBank: 'Podgląd banku',
  ownerAll: 'Wszystkie',
  ownerMine: 'Moje',
  groupAny: 'Dowolna grupa',
  groupMine: 'Moje grupy',
  bankDetailTitle: 'Pytania',
  readOnlyNotice: 'Podgląd banku. Pytania może dodawać i zmieniać tylko jego autor lub nauczyciel.',
  noQuestionsReadOnly: 'Brak pytań w tym banku.',
} as const;

/** The bank the case creates („Fizyka”), plus the two banks the filters need. */
const BANKS = {
  group: 'Fizyka',
  secondGroup: 'Chemia',
  personal: 'Biologia',
} as const;

const DESCRIPTION = 'Dział: kinematyka';

const GROUP_1 = 'G1';
const GROUP_2 = 'G2';

const TENANT = loadTenant(CASE);

interface TenantUser {
  id: string;
  email: string;
  password: string;
}

function user(key: string): TenantUser {
  const account = TENANT.users[key];
  if (!account) throw new Error(`${CASE} tenant has no seeded ${key} user`);
  return account;
}

const TEACHER = user('teacher');
const STUDENT_IN = user('studentIn');
const STUDENT_OUT = user('studentOut');

/** The default group `G1` (`O1G1`) and the empty second group `G2`. */
const GROUP_1_ID = TENANT.group?.id;
const GROUP_2_ID = tenantId(TENANT.key, 'group:2');
if (!GROUP_1_ID) throw new Error(`${CASE} tenant has no seeded default group`);

interface BankListItem {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  organization_id: string | null;
  visibility: 'personal' | 'group';
  groupIds: string[];
  question_count: number;
}

interface BankListResult {
  items: BankListItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface GroupMemberRow {
  userId: string;
  role: 'teacher' | 'member';
}

/** A bank card in the grid, addressed by its own heading so no sibling matches. */
function bankCard(page: Page, name: string): Locator {
  return page
    .locator('main [data-slot="card"]')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });
}

/**
 * A group badge on a card. Each card renders a mobile and a desktop copy, so the
 * locator is pinned to the one the current breakpoint shows.
 */
function groupBadge(card: Locator, groupName: string): Locator {
  return card
    .locator('[data-slot="badge"]:visible')
    .filter({ hasText: new RegExp(`^${groupName}$`) });
}

async function getData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.ok(), `GET ${url} → ${response.status()} ${await response.text()}`).toBe(true);
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data;
}

/** `GET /api/v1/questions/banks` — the same list the screen renders. */
async function listBanks(page: Page): Promise<BankListResult> {
  return getData<BankListResult>(page, `${BANKS_URL}?limit=100`);
}

async function findBank(page: Page, name: string): Promise<BankListItem | undefined> {
  return (await listBanks(page)).items.find((bank) => bank.name === name);
}

/**
 * A retry against the same seeded tenant must start from the same state: drop the
 * banks a previous run left behind (the case's own names only, same tenant) so the
 * first test can create „Fizyka” through the dialog again.
 */
async function resetBanks(page: Page): Promise<void> {
  const names: string[] = Object.values(BANKS);
  for (const bank of (await listBanks(page)).items.filter((row) => names.includes(row.name))) {
    const response = await page.request.delete(`${BANKS_URL}/${bank.id}`);
    expect(response.ok(), `DELETE ${BANKS_URL}/${bank.id} → ${response.status()}`).toBe(true);
  }
}

/**
 * Create one of the case's banks if this tenant does not have it yet. The two
 * banks the filters need are built through the product API (the case's own bank is
 * created through the UI); idempotent so a run never duplicates a name.
 */
async function ensureBank(
  page: Page,
  name: string,
  data: { visibility: 'personal' | 'group'; groupIds?: string[]; description?: string },
): Promise<BankListItem> {
  const existing = await findBank(page, name);
  if (existing) return existing;

  const response = await page.request.post(BANKS_URL, { data: { name, ...data } });
  expect(
    response.status(),
    `POST ${BANKS_URL} (${name}) → ${response.status()} ${await response.text()}`,
  ).toBe(201);
  const body = (await response.json()) as ApiEnvelope<BankListItem>;
  expect(body.success, `POST ${BANKS_URL} (${name}) success flag`).toBe(true);
  return body.data;
}

/** The bank-list request the screen fires once a filter changes. */
function bankListRequest(page: Page, predicate: (params: URLSearchParams) => boolean) {
  return page.waitForRequest((request) => {
    if (!request.url().includes(`${BANKS_URL}?`)) return false;
    return predicate(new URL(request.url()).searchParams);
  });
}

/** Uncaught errors and failed documents for the whole walk. */
function watchPage(page: Page) {
  const pageErrors: string[] = [];
  const failedDocuments: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => {
    if (response.request().resourceType() === 'document' && response.status() >= 400) {
      failedDocuments.push(`${response.status()} ${new URL(response.url()).pathname}`);
    }
  });
  return { pageErrors, failedDocuments };
}

/** Replace a group's roster through the manager/creator endpoint. */
async function setGroupMembers(
  page: Page,
  groupId: string,
  members: GroupMemberRow[],
): Promise<void> {
  const url = `/api/v1/organization/groups/${groupId}/members`;
  const response = await page.request.put(url, { data: { members } });
  expect(response.ok(), `PUT ${url} → ${response.status()} ${await response.text()}`).toBe(true);
}

/**
 * The case's own group shape: `G1` holds the teacher and student1, `G2` holds the
 * teacher and only the student outside the group. The seeder enrols every member
 * in the default group and leaves `G2` without a teacher (a group is offered in the
 * pickers only when it has one), so both rosters are written here through the same
 * endpoint `/manage/groups` uses — tenant-local and idempotent.
 */
test.beforeAll(async ({ browser }) => {
  const baseURL = process.env.QA_APP_URL ?? 'http://localhost:3010';
  const context = await browser.newContext({ baseURL });
  try {
    const page = await context.newPage();
    await loginAs(page, TENANT, 'teacher', { locale: 'pl' });
    await setGroupMembers(page, GROUP_1_ID, [
      { userId: TEACHER.id, role: 'teacher' },
      { userId: STUDENT_IN.id, role: 'member' },
    ]);
    await setGroupMembers(page, GROUP_2_ID, [
      { userId: TEACHER.id, role: 'teacher' },
      { userId: STUDENT_OUT.id, role: 'member' },
    ]);
  } finally {
    await context.close();
  }
});

test.describe('@case:EDU-Q-01 @area:EDU @prio:P2 group question bank', () => {
  test('creates a „Grupy” bank that the G1 student reads and a G2 student does not', async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(150_000);
    const { pageErrors, failedDocuments } = watchPage(page);

    // ── Teacher: „Nowy bank” → „Fizyka” → „Grupy” → G1 ─────────────────────
    await loginAs(page, TENANT, 'teacher', { locale: 'pl' });
    expect(new URL(page.url()).pathname, 'educator lands on /edu').toBe('/edu');
    await page.goto('/edu/questions');
    await expect(page).toHaveURL(/\/edu\/questions$/);

    // A retry against the same tenant starts from an empty bank list.
    await resetBanks(page);
    await page.reload();

    await page.getByRole('button', { name: COPY.newBank }).first().click();
    const dialog = page.locator('[data-slot="dialog-content"]');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: COPY.createTitle })).toBeVisible();

    await dialog.locator('#bank-name').fill(BANKS.group);
    await dialog.locator('#bank-desc').fill(DESCRIPTION);
    await dialog.locator('label[for="qb-visibility-group"]').click();
    await expect(dialog.locator('#qb-visibility-group')).toHaveAttribute('aria-checked', 'true');

    // The group picker offers this organization's groups only.
    await dialog.getByRole('combobox').click();
    const groupOptions = page.locator('[data-slot="popover-content"] [role="option"]');
    await expect(groupOptions).toHaveCount(2);
    expect((await groupOptions.allInnerTexts()).sort(), 'group picker options').toEqual([
      GROUP_1,
      GROUP_2,
    ]);
    await page.getByRole('option', { name: GROUP_1, exact: true }).click();
    // The multi-select keeps its popover open after a pick; the dialog title
    // closes it without touching the rest of the form.
    await dialog.getByRole('heading', { name: COPY.createTitle }).click();
    await expect(page.locator('[data-slot="popover-content"]')).toHaveCount(0);
    await expect(dialog.getByRole('combobox')).toContainText(GROUP_1);

    await dialog.getByRole('button', { name: COPY.create }).click();

    // 1. „Bank pytań utworzony”, stored as a group bank shared to G1 only.
    await expect(page.getByText(COPY.created, { exact: true }).first()).toBeVisible();
    await expect(page.locator('[data-slot="dialog-content"]')).toHaveCount(0);

    const teacherCard = bankCard(page, BANKS.group);
    await expect(teacherCard).toBeVisible();
    await expect(teacherCard).toContainText(DESCRIPTION);
    await expect(groupBadge(teacherCard, GROUP_1)).toHaveCount(1);
    await expect(teacherCard.getByRole('button', { name: COPY.manage })).toBeVisible();

    const created = await findBank(page, BANKS.group);
    expect(created, 'the created bank is readable by its author').toBeTruthy();
    const bankId = created!.id;
    expect(created!.visibility, 'bank visibility').toBe('group');
    expect(created!.groupIds, 'bank group share').toEqual([GROUP_1_ID]);
    expect(created!.description, 'the optional description is stored').toBe(DESCRIPTION);
    expect(created!.organization_id, 'the bank belongs to the tenant organization').toBe(
      TENANT.org!.id,
    );

    // ── 2. The G1 student sees the bank read-only ──────────────────────────
    const studentInContext = await browser.newContext({ baseURL });
    try {
      const studentPage = await studentInContext.newPage();
      const inErrors: string[] = [];
      studentPage.on('pageerror', (error) => inErrors.push(error.message));

      await loginAs(studentPage, TENANT, 'studentIn', { locale: 'pl' });
      expect(new URL(studentPage.url()).pathname, 'student lands on /app').toBe('/app');
      await studentPage.goto('/app/questions');

      const studentCard = bankCard(studentPage, BANKS.group);
      await expect(studentCard, 'the G1 student sees the shared bank').toBeVisible();
      await expect(groupBadge(studentCard, GROUP_1)).toHaveCount(1);
      await expect(studentCard.getByRole('button', { name: COPY.viewBank })).toBeVisible();
      await expect(
        studentCard.getByRole('button', { name: COPY.manage }),
        'a shared bank is not manageable by a student',
      ).toHaveCount(0);

      const studentList = await listBanks(studentPage);
      expect(
        studentList.items.map((bank) => bank.id),
        'the shared bank is in the student list',
      ).toContain(bankId);

      // „Podgląd banku”: the detail is read-only — no create action, notice shown.
      await studentPage.goto(`/app/questions/${bankId}`);
      await expect(
        studentPage.getByRole('heading', { name: BANKS.group, exact: true }),
      ).toBeVisible();
      await expect(studentPage.getByText(COPY.readOnlyNotice, { exact: true })).toBeVisible();
      await expect(
        studentPage.getByRole('button', { name: 'Utwórz pytanie' }),
        'the student may not add questions',
      ).toHaveCount(0);
      await expect(studentPage.getByText(COPY.noQuestionsReadOnly, { exact: true })).toBeVisible();

      const detail = await studentPage.request.get(`${BANKS_URL}/${bankId}`);
      expect(detail.status(), 'the G1 student may open the shared bank').toBe(200);

      expect(inErrors, 'uncaught page errors for the G1 student').toEqual([]);
    } finally {
      await studentInContext.close();
    }

    // ── 3. A student outside G1 does not see the bank ──────────────────────
    const studentOutContext = await browser.newContext({ baseURL });
    try {
      const outsiderPage = await studentOutContext.newPage();
      const outErrors: string[] = [];
      outsiderPage.on('pageerror', (error) => outErrors.push(error.message));

      await loginAs(outsiderPage, TENANT, 'studentOut', { locale: 'pl' });
      expect(new URL(outsiderPage.url()).pathname, 'student lands on /app').toBe('/app');
      await outsiderPage.goto('/app/questions');

      await expect(
        bankCard(outsiderPage, BANKS.group),
        'a group share does not reach another group of the same organization',
      ).toHaveCount(0);

      const outsiderList = await listBanks(outsiderPage);
      expect(
        outsiderList.items.map((bank) => bank.id),
        'the G2 student list must not contain the G1 bank',
      ).not.toContain(bankId);

      const hiddenDetail = await outsiderPage.request.get(`${BANKS_URL}/${bankId}`);
      expect(hiddenDetail.status(), 'the G2 student gets NOT_FOUND').toBe(404);

      expect(outErrors, 'uncaught page errors for the G2 student').toEqual([]);
    } finally {
      await studentOutContext.close();
    }

    expect(failedDocuments, 'no navigation may answer with an error status').toEqual([]);
    expect(pageErrors, 'uncaught page errors during the walk').toEqual([]);
  });

  test('offers the Wszystkie / Moje scope and the group multi-select, with no „Grupy” scope', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const { pageErrors } = watchPage(page);

    await loginAs(page, TENANT, 'teacher', { locale: 'pl' });
    expect(new URL(page.url()).pathname, 'educator lands on /edu').toBe('/edu');

    // This test is self-contained: it rebuilds the three banks it filters, so a
    // single-test run and a repeat against the same tenant both start clean.
    await resetBanks(page);
    await ensureBank(page, BANKS.group, {
      visibility: 'group',
      groupIds: [GROUP_1_ID],
      description: DESCRIPTION,
    });
    await ensureBank(page, BANKS.secondGroup, {
      visibility: 'group',
      groupIds: [GROUP_2_ID],
    });
    await ensureBank(page, BANKS.personal, { visibility: 'personal' });

    await page.goto('/edu/questions');
    await expect(page).toHaveURL(/\/edu\/questions$/);
    for (const name of Object.values(BANKS)) {
      await expect(bankCard(page, name), `card "${name}" before filtering`).toBeVisible();
    }

    // 4a. The scope select offers exactly „Wszystkie” / „Moje”. It is the first
    // Radix `Select` of the toolbar (the second one is the sort select).
    const ownerSelect = page.locator('[data-slot="select-trigger"]').first();
    await expect(ownerSelect).toContainText(COPY.ownerAll);
    await ownerSelect.click();

    const ownerOptions = page.getByRole('option');
    await expect(ownerOptions).toHaveCount(2);
    await expect(ownerOptions.nth(0)).toHaveText(COPY.ownerAll);
    await expect(ownerOptions.nth(1)).toHaveText(COPY.ownerMine);
    // „Grupy” is a visibility, not a list scope, and the retired toggles must not return.
    await expect(page.getByRole('option', { name: COPY.visibilityGroup, exact: true })).toHaveCount(
      0,
    );
    await page.keyboard.press('Escape');

    // 4b. The group filter is one multi-select with both groups and a quick action.
    const groupSelect = page.locator('button[role="combobox"]:not([data-slot="select-trigger"])');
    await expect(groupSelect).toContainText(COPY.groupAny);
    await groupSelect.click();
    const groupFilterOptions = page.locator('[data-slot="popover-content"] [role="option"]');
    await expect(groupFilterOptions).toHaveCount(2);
    expect((await groupFilterOptions.allInnerTexts()).sort(), 'group filter options').toEqual([
      GROUP_1,
      GROUP_2,
    ]);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-slot="popover-content"]')).toHaveCount(0);

    const mineGroups = page.getByRole('button', { name: COPY.groupMine, exact: true });
    await expect(mineGroups).toBeVisible();
    await expect(mineGroups).toBeEnabled();

    // Picking only G1 keeps the G1 bank and drops the G2 and ungrouped ones.
    await groupSelect.click();
    await expect(page.getByRole('option', { name: GROUP_1, exact: true })).toBeVisible();
    const g1Request = bankListRequest(page, (params) => params.get('groups') === GROUP_1_ID);
    await page.getByRole('option', { name: GROUP_1, exact: true }).click();
    await g1Request;
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-slot="popover-content"]')).toHaveCount(0);

    await expect(groupSelect).toContainText(GROUP_1);
    await expect(bankCard(page, BANKS.group), 'the G1 bank').toBeVisible();
    await expect(
      bankCard(page, BANKS.secondGroup),
      'the G2 bank is outside the filter',
    ).toHaveCount(0);
    await expect(
      bankCard(page, BANKS.personal),
      'an ungrouped bank is outside the filter',
    ).toHaveCount(0);

    // „Moje grupy” selects G1 + G2: both group banks stay, the personal one does not.
    const bothGroups = [GROUP_1_ID, GROUP_2_ID].sort().join(',');
    const mineGroupsRequest = bankListRequest(
      page,
      (params) => (params.get('groups') ?? '').split(',').sort().join(',') === bothGroups,
    );
    await mineGroups.click();
    await mineGroupsRequest;

    await expect(mineGroups).toBeDisabled();
    await expect(groupSelect).toContainText(GROUP_1);
    await expect(groupSelect).toContainText(GROUP_2);
    await expect(bankCard(page, BANKS.group)).toBeVisible();
    await expect(bankCard(page, BANKS.secondGroup)).toBeVisible();
    await expect(bankCard(page, BANKS.personal)).toHaveCount(0);

    // „Moje” narrows the scope to the educator's own banks — all three are theirs,
    // so the group selection (and its result) stays while the request carries it.
    const mineRequest = bankListRequest(page, (params) => params.get('owner') === 'mine');
    await ownerSelect.click();
    await page.getByRole('option', { name: COPY.ownerMine, exact: true }).click();
    await mineRequest;

    await expect(ownerSelect).toContainText(COPY.ownerMine);
    await expect(bankCard(page, BANKS.group)).toBeVisible();
    await expect(bankCard(page, BANKS.secondGroup)).toBeVisible();
    await expect(bankCard(page, BANKS.personal)).toHaveCount(0);

    // The retired scope parameter is rejected instead of silently changing the list.
    const legacy = await page.request.get(`${BANKS_URL}?groupFilter=mine`);
    expect(legacy.status(), 'the retired groupFilter scope is a validation error').toBe(422);

    expect(pageErrors, 'uncaught page errors on the question-bank list').toEqual([]);
  });
});
