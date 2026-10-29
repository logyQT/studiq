import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';
import { tenantKey } from '#test/e2e/fixtures/ids';
import {
  buildAccount,
  createSeedDb,
  randomTag,
  seedTenantGraph,
  tenantId,
} from '#test/helpers/tenant-seed';

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
 * Tenant: `tenantKey('qa/cases/EDU-Q-01.md', 'EDU-Q-01 group question bank',
 * 'qa-shared')::<run suffix>`, a fresh suffix per independent run, every id from
 * `tenantId(key, entity)`:
 *   - `teacher` — educator and org role `teacher` (so it holds `question_bank.create`
 *     and `group.manage`), group teacher of both groups; only a group teacher may
 *     share content to a group;
 *   - `studentIn` — org member and member of the default group `G1` (the case's
 *     student1);
 *   - `studentOut` — org member of the second group `G2` only. The seeder enrols
 *     every member in the default group, so the spec moves this one row to `G2`
 *     (tenant-local, deterministic id) — that is exactly the case's „student spoza
 *     grupy”.
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
const CASE_FILE = 'qa/cases/EDU-Q-01.md';
const TITLE = 'EDU-Q-01 group question bank';
const PROJECT = 'qa-shared';
const RUN_SUFFIX = process.env.QA_RUN_SUFFIX ?? `${Date.now().toString(36)}-${randomTag(4)}`;

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

/** Supabase local defaults (the service-role JWT is the `supabase start` demo key). */
const LOCAL_SUPABASE_URL = 'http://localhost:54421';
const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

interface CaseTenant {
  key: string;
  group1: { id: string; name: string };
  group2: { id: string; name: string };
  /** The educator who creates the bank (org A, group teacher of G1 + G2). */
  teacher: QaTenant;
  /** Org member, member of G1 — the case's student1. */
  studentIn: QaTenant;
  /** Org member, member of G2 only — the case's „student spoza grupy”. */
  studentOut: QaTenant;
}

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

function account(seed: { id: string; email: string; password: string }) {
  return { id: seed.id, email: seed.email, password: seed.password };
}

async function seedCaseTenant(): Promise<CaseTenant> {
  const key = `${tenantKey(CASE_FILE, TITLE, PROJECT)}::${RUN_SUFFIX}`;
  const { url, serviceKey } = resolveSupabase();
  const db = createSeedDb({ url, serviceKey });

  const org = { id: tenantId(key, 'org'), name: `qa-eduq01-${RUN_SUFFIX}` };
  const group1 = { id: tenantId(key, 'group:default'), name: GROUP_1 };
  const group2 = { id: tenantId(key, 'group:second'), name: GROUP_2 };
  const teacher = buildAccount(key, 'teacher', 'educator', {
    name: 'QA teacher',
    orgRole: 'teacher',
  });
  const studentIn = buildAccount(key, 'student-in', 'student', { name: 'QA student in G1' });
  const studentOut = buildAccount(key, 'student-out', 'student', { name: 'QA student outside G1' });

  const seeded = await seedTenantGraph(db, {
    key,
    org,
    defaultGroup: { ...group1, isDefault: true },
    extraGroups: [{ ...group2, isDefault: false }],
    owner: teacher,
    members: [studentIn, studentOut],
    ownerOrgRole: 'teacher',
  });

  // `seedTenantGraph` enrols every member in the default group; the case needs one
  // org member who is in G2 only. Move that membership row (its id is deterministic).
  const moved = await db
    .from('group_members')
    .update({ group_id: group2.id })
    .eq('id', tenantId(key, 'gm:1'));
  if (moved.error)
    throw new Error(`seed ${CASE}: group_members(studentOut → G2) ${moved.error.message}`);

  // A group is offered in the pickers only when it has a teacher, and only a group
  // teacher may share content to it: enrol the owner as G2's teacher too.
  const secondGroupTeacher = await db.from('group_members').upsert(
    {
      id: tenantId(key, 'gm:second:owner'),
      group_id: group2.id,
      user_id: teacher.id,
      role: 'teacher',
    },
    { onConflict: 'id' },
  );
  if (secondGroupTeacher.error) {
    throw new Error(`seed ${CASE}: group_members(G2 teacher) ${secondGroupTeacher.error.message}`);
  }

  const base = { case: CASE, key, profile: 'content' as const, runSuffix: RUN_SUFFIX };

  return {
    key,
    group1,
    group2,
    teacher: {
      ...base,
      org,
      group: group1,
      users: { teacher: account(seeded.owner) },
    },
    // Both student tenants expose the account under the fixture's `student` key;
    // they are separate objects, so `loginAs(..., 'student')` stays unambiguous.
    studentIn: {
      ...base,
      org,
      group: group1,
      users: { student: account(seeded.members[0]) },
    },
    studentOut: {
      ...base,
      org,
      group: group2,
      users: { student: account(seeded.members[1]) },
    },
  };
}

let tenant: CaseTenant;

test.beforeAll(async () => {
  tenant = await seedCaseTenant();
  console.log(`EDU-Q-01 tenant key: ${tenant.key} (org ${tenant.teacher.org?.id})`);
});

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

test.describe('@case:EDU-Q-01 @area:EDU @prio:P2 group question bank', () => {
  test('creates a „Grupy” bank that the G1 student reads and a G2 student does not', async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(150_000);
    const { pageErrors, failedDocuments } = watchPage(page);

    // ── Teacher: „Nowy bank” → „Fizyka” → „Grupy” → G1 ─────────────────────
    await loginAs(page, tenant.teacher, 'teacher', { locale: 'pl' });
    expect(new URL(page.url()).pathname, 'educator lands on /edu').toBe('/edu');
    await page.goto('/edu/questions');
    await expect(page).toHaveURL(/\/edu\/questions$/);

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
    expect(created!.groupIds, 'bank group share').toEqual([tenant.group1.id]);
    expect(created!.description, 'the optional description is stored').toBe(DESCRIPTION);
    expect(created!.organization_id, 'the bank belongs to the tenant organization').toBe(
      tenant.teacher.org!.id,
    );

    // ── 2. The G1 student sees the bank read-only ──────────────────────────
    const studentInContext = await browser.newContext({ baseURL });
    try {
      const studentPage = await studentInContext.newPage();
      const inErrors: string[] = [];
      studentPage.on('pageerror', (error) => inErrors.push(error.message));

      await loginAs(studentPage, tenant.studentIn, 'student', { locale: 'pl' });
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

      await loginAs(outsiderPage, tenant.studentOut, 'student', { locale: 'pl' });
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

    await loginAs(page, tenant.teacher, 'teacher', { locale: 'pl' });
    expect(new URL(page.url()).pathname, 'educator lands on /edu').toBe('/edu');

    // This test is self-contained: its own bank through the UI is created by the
    // first test, but a single-test run still needs all three banks to filter.
    await ensureBank(page, BANKS.group, {
      visibility: 'group',
      groupIds: [tenant.group1.id],
      description: DESCRIPTION,
    });
    await ensureBank(page, BANKS.secondGroup, {
      visibility: 'group',
      groupIds: [tenant.group2.id],
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
    const g1Request = bankListRequest(page, (params) => params.get('groups') === tenant.group1.id);
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
    const bothGroups = [tenant.group1.id, tenant.group2.id].sort().join(',');
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
