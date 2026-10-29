import { expect, test, type Page } from '@playwright/test';
import { createQaSupabase } from '@qa/fixtures/qa-db';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * STU-31 — the student's question-bank list (`/app/questions`).
 *
 * Case: a student opens `/app/questions` and works the toolbar — the scope select
 * („Wszystkie” / „Moje”), the group filter („Dowolna grupa” / „Moje grupy”), the
 * „Szukaj banków…” search and the sort select.
 *
 * Tenant (deterministic, `content` profile, a fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts STU-31 --fresh
 *
 * gives the organization `qa-stu-31-<suffix>` with a manager, an educator and the
 * student under test, plus the default group `G1` — all ids derived from
 * `tenantKey('qa/cases/STU-31.md', 'STU-31#<suffix>', 'qa-shared')` +
 * `tenantId(key, entity)`. The legacy `student-classroom@dev.local` seed is never
 * used.
 *
 * The profile seeds the graph only, so the case's content is built here through the
 * product API inside this tenant:
 * 1. Two group banks authored by the tenant's manager — the seeded default group's
 *    `teacher` member (the seeder enrols the tenant educator as a group `member`, so
 *    the educator cannot share content to the group). They reproduce the case's
 *    „Historia” (4 questions: 2 multiple-choice, 1 true/false, 1 open) and
 *    „Geografia i Nauka” (6 questions: 2/2/2), shared with `G1`.
 * 2. One personal bank owned by the student, so both the „Moje” scope and the group
 *    filter's narrowing are observable — with only the two group banks, „Moje” is
 *    empty and the group filter matches the unfiltered list.
 *
 * CI seeds a case tenant once and Playwright retries reuse it, so the test first
 * deletes this tenant's own question banks (questions and `bank_groups` cascade) and
 * rebuilds them: a retry must never depend on, or trip over, what the previous
 * attempt left behind (including the plan's bank quota).
 *
 * Acceptance points (walked on the shared app, Polish UI, 2026-10-29):
 * 1. Both group banks are listed with their own counter — „4 pytania” and
 *    „6 pytań” — and carry the group badge; the student owns neither, so each card
 *    offers the read-only action „Podgląd banku” (never „Zarządzaj”). The
 *    student's own bank shows „Zarządzaj” instead.
 * 2. The scope select offers exactly „Wszystkie” and „Moje” — the retired „Grupy”
 *    scope is gone (the API rejects its `groupFilter` parameter with a 422).
 * 3. „Moje” narrows the list to the student's own bank; „Wszystkie” restores all.
 * 4. The search „Szukaj banków...” narrows on the bank name, and a miss shows
 *    „Nie znaleziono banków dla „<query>”” with a „Wyczyść filtry” action that
 *    restores the unfiltered list.
 * 5. Sorting works: „Nazwa A-Z” orders the cards Geografia → Historia → Moje, and
 *    „Nazwa Z-A” reverses that.
 * 6. The group filter lists the student's group; selecting it (or pressing
 *    „Moje grupy”) keeps only the banks shared with that group and drops the
 *    student's personal bank.
 *
 * Polish copy is asserted because the case quotes the Polish UI; the fixture pins
 * `NEXT_LOCALE=pl` so a locale cookie from another case cannot change it.
 */

const CASE = 'STU-31';

/** Polish copy from `QuestionBankManagement` (pl.json) and the walk. */
const COPY = {
  ownerAll: 'Wszystkie',
  ownerMine: 'Moje',
  /** The retired scope value that must not come back as an option (#595). */
  retiredScope: 'Grupy',
  groupAny: 'Dowolna grupa',
  groupMine: 'Moje grupy',
  search: 'Szukaj banków...',
  sortNewest: 'Najnowsze',
  sortNameAsc: 'Nazwa A-Z',
  sortNameDesc: 'Nazwa Z-A',
  viewBank: 'Podgląd banku',
  manageBank: 'Zarządzaj',
  noResultsForFilters: 'Nie znaleziono banków dla wybranych filtrów',
  noResultsFor: (query: string) => `Nie znaleziono banków dla „${query}”`,
  clearFilters: 'Wyczyść filtry',
} as const;

type QuestionType = 'mcq' | 'true_false' | 'open';

interface GroupBankSpec {
  name: string;
  description: string;
  /** Question mix from the case's seed (Historia 2 WW / 1 P-F / 1 open, Geografia 2/2/2). */
  types: QuestionType[];
}

const GROUP_BANKS: GroupBankSpec[] = [
  {
    name: 'Historia',
    description: 'Historia — średniowiecze',
    types: ['mcq', 'mcq', 'true_false', 'open'],
  },
  {
    name: 'Geografia i Nauka',
    description: 'Geografia i nauka',
    types: ['mcq', 'mcq', 'true_false', 'true_false', 'open', 'open'],
  },
];

/** The student's own personal bank; the reason „Moje” and the group filter differ. */
const OWN_BANK = { name: 'Moje notatki STU-31', countLabel: '0 pytań' } as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

/** Polish plural counter rendered on the card („1 pytanie” / „4 pytania” / „6 pytań”). */
function questionCountLabel(count: number): string {
  if (count === 1) return '1 pytanie';
  const lastTwo = count % 100;
  const last = count % 10;
  const few = last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14);
  return `${count} ${few ? 'pytania' : 'pytań'}`;
}

/** A visible bank card, addressed by its own heading. */
function bankCard(page: Page, name: string) {
  return page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });
}

/** The card headings in render order (only the desktop body is visible). */
function bankTitles(page: Page) {
  return page.locator('[data-slot="card"] h3:visible');
}

/**
 * Retry-safety: CI seeds a case tenant once and reuses it for every retry, so a
 * failed attempt leaves its banks behind — and the student's plan only allows five.
 * Delete just this tenant organization's banks (questions and `bank_groups`
 * cascade); the destructive steps of another tenant are never touched.
 */
async function resetTenantBanks(tenant: QaTenant): Promise<void> {
  if (!tenant.org) throw new Error(`${CASE} tenant has no organization to reset`);
  const db = createQaSupabase();
  const deleted = await db
    .from('question_banks')
    .delete()
    .eq('organization_id', tenant.org.id)
    .select('id');
  expect(
    deleted.error,
    `delete ${CASE} tenant question banks: ${deleted.error?.message ?? ''}`,
  ).toBeNull();
}

async function createQuestion(
  page: Page,
  bankId: string,
  content: string,
  type: QuestionType,
): Promise<void> {
  const answers =
    type === 'open'
      ? []
      : type === 'true_false'
        ? [
            { content: 'Prawda', isCorrect: true, orderIndex: 0 },
            { content: 'Fałsz', isCorrect: false, orderIndex: 1 },
          ]
        : [
            { content: 'Odpowiedź A', isCorrect: true, orderIndex: 0 },
            { content: 'Odpowiedź B', isCorrect: false, orderIndex: 1 },
          ];

  const response = await page.request.post('/api/v1/questions', {
    data: { bankId, type, content, answers },
  });
  const text = await response.text();
  expect(response.status(), `POST /api/v1/questions (${content}) → ${text}`).toBe(201);
  const body = JSON.parse(text) as ApiEnvelope<{ id: string; type: string }>;
  expect(body.data.type, `„${content}” keeps its type`).toBe(type);
}

/** One group bank (with its questions) authored by the tenant's group teacher. */
async function seedGroupBank(page: Page, tenant: QaTenant, spec: GroupBankSpec): Promise<void> {
  const response = await page.request.post('/api/v1/questions/banks', {
    data: {
      name: spec.name,
      description: spec.description,
      visibility: 'group',
      groupIds: [tenant.group!.id],
    },
  });
  const text = await response.text();
  expect(response.status(), `POST /api/v1/questions/banks (${spec.name}) → ${text}`).toBe(201);
  const bank = (
    JSON.parse(text) as ApiEnvelope<{ id: string; visibility: string; groupIds: string[] }>
  ).data;
  expect(bank.visibility, `„${spec.name}” is a group bank`).toBe('group');
  expect(bank.groupIds, `„${spec.name}” is shared with the tenant group`).toEqual([
    tenant.group!.id,
  ]);

  for (const [index, type] of spec.types.entries()) {
    await createQuestion(page, bank.id, `${spec.name} — pytanie ${index + 1}`, type);
  }
}

test.describe('@case:STU-31 @area:STU @prio:P2 student question banks', () => {
  test('lists the group banks with counts and read-only actions, and filters them', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} runs on the content tenant profile`).toBe('content');
    expect(
      tenant.runSuffix,
      'seed with --fresh: every independent run owns a new tenant',
    ).toBeTruthy();
    expect(tenant.org, 'the student under test belongs to the tenant organization').toBeTruthy();
    expect(tenant.group, 'the case needs the tenant default group').toBeTruthy();
    expect(tenant.users.manager, `${CASE} seeds the group teacher account`).toBeTruthy();
    expect(tenant.users.student, `${CASE} seeds the student under test`).toBeTruthy();

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // ── Prerequisite: the tenant graph, with no bank left from a retry ───────
    await resetTenantBanks(tenant);

    await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage(\/|$)/ });
    for (const spec of GROUP_BANKS) {
      await seedGroupBank(page, tenant, spec);
    }

    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
    const ownBank = await page.request.post('/api/v1/questions/banks', {
      data: { name: OWN_BANK.name },
    });
    expect(ownBank.status(), 'POST /api/v1/questions/banks (the student’s own bank)').toBe(201);

    // ── Step 1: open /app/questions ─────────────────────────────────────────
    const response = await page.goto('/app/questions');
    expect(response?.status(), 'GET /app/questions').toBe(200);
    await expect(page).toHaveURL(/\/app\/questions$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

    // The toolbar the case exercises: scope, group filter, search, sort.
    const ownerSelect = page.locator('[data-slot="select-trigger"]').filter({
      hasText: COPY.ownerAll,
    });
    await expect(ownerSelect).toBeVisible();
    const groupFilter = page.locator('button[role="combobox"]:not([data-slot="select-trigger"])');
    await expect(groupFilter).toContainText(COPY.groupAny);
    await expect(page.getByPlaceholder(COPY.search)).toBeVisible();
    await expect(
      page.locator('[data-slot="select-trigger"]').filter({ hasText: COPY.sortNewest }),
    ).toBeVisible();

    // ── Step 2a: the group banks and their counters ─────────────────────────
    for (const spec of GROUP_BANKS) {
      const card = bankCard(page, spec.name);
      await expect(card, `„${spec.name}” is listed once`).toHaveCount(1);
      await expect(card, `„${spec.name}” counts its questions`).toContainText(
        questionCountLabel(spec.types.length),
      );
      await expect(card, `„${spec.name}” carries its group badge`).toContainText(
        tenant.group!.name,
      );
      // The student does not own these banks: the card offers the read-only action.
      await expect(
        card.getByRole('button', { name: COPY.viewBank, exact: true }),
        `„${spec.name}” offers „${COPY.viewBank}”`,
      ).toBeVisible();
      await expect(
        card.getByRole('button', { name: COPY.manageBank, exact: true }),
        `„${spec.name}” is not editable by the student`,
      ).toHaveCount(0);
    }

    // The student's own bank is the contrasting write path, and proves the „Moje”
    // scope below has something to show.
    const ownCard = bankCard(page, OWN_BANK.name);
    await expect(ownCard, 'the student’s own bank is listed').toHaveCount(1);
    await expect(ownCard).toContainText(OWN_BANK.countLabel);
    await expect(
      ownCard.getByRole('button', { name: COPY.manageBank, exact: true }),
      'the student manages their own bank',
    ).toBeVisible();
    await expect(
      ownCard.getByRole('button', { name: COPY.viewBank, exact: true }),
      'the own bank is not read-only',
    ).toHaveCount(0);

    // ── Step 2b: the scope select — „Wszystkie” / „Moje”, never „Grupy” ─────
    await ownerSelect.click();
    const ownerOptions = page.getByRole('option');
    await expect(ownerOptions).toHaveCount(2);
    await expect(ownerOptions.nth(0)).toHaveText(COPY.ownerAll);
    await expect(ownerOptions.nth(1)).toHaveText(COPY.ownerMine);
    await expect(
      page.getByRole('option', { name: COPY.retiredScope, exact: true }),
      'the retired „Grupy” scope is not offered',
    ).toHaveCount(0);

    await page.getByRole('option', { name: COPY.ownerMine, exact: true }).click();
    await expect(page.locator('[data-slot="card"]'), '„Moje” keeps only the own bank').toHaveCount(
      1,
    );
    await expect(bankCard(page, OWN_BANK.name)).toBeVisible();
    for (const spec of GROUP_BANKS) {
      await expect(bankCard(page, spec.name), `„${spec.name}” is not owned`).toHaveCount(0);
    }

    await page.locator('[data-slot="select-trigger"]').filter({ hasText: COPY.ownerMine }).click();
    await page.getByRole('option', { name: COPY.ownerAll, exact: true }).click();
    await expect(page.locator('[data-slot="card"]'), '„Wszystkie” restores every bank').toHaveCount(
      3,
    );

    // ── Step 2c: the search ─────────────────────────────────────────────────
    const search = page.getByPlaceholder(COPY.search);
    await search.fill('Hist');
    await expect(
      page.locator('[data-slot="card"]'),
      'the search narrows on the bank name',
    ).toHaveCount(1);
    await expect(bankCard(page, 'Historia')).toBeVisible();

    await search.fill('Biologia');
    await expect(page.getByText(COPY.noResultsFor('Biologia'), { exact: true })).toBeVisible();
    await expect(page.locator('[data-slot="card"]'), 'a miss renders no bank card').toHaveCount(0);

    await page.getByRole('button', { name: COPY.clearFilters, exact: true }).click();
    await expect(
      page.locator('[data-slot="card"]'),
      '„Wyczyść filtry” restores the list',
    ).toHaveCount(3);
    await expect(search).toHaveValue('');
    await expect(
      page.locator('[data-slot="select-trigger"]').filter({ hasText: COPY.ownerAll }),
    ).toBeVisible();

    // ── Step 2d: sorting ────────────────────────────────────────────────────
    await page.locator('[data-slot="select-trigger"]').filter({ hasText: COPY.sortNewest }).click();
    await page.getByRole('option', { name: COPY.sortNameAsc, exact: true }).click();
    await expect(bankTitles(page), '„Nazwa A-Z” orders the cards by name').toHaveText([
      'Geografia i Nauka',
      'Historia',
      OWN_BANK.name,
    ]);

    await page
      .locator('[data-slot="select-trigger"]')
      .filter({ hasText: COPY.sortNameAsc })
      .click();
    await page.getByRole('option', { name: COPY.sortNameDesc, exact: true }).click();
    await expect(bankTitles(page), '„Nazwa Z-A” reverses the order').toHaveText([
      OWN_BANK.name,
      'Historia',
      'Geografia i Nauka',
    ]);

    // ── Step 2e: the group filter narrows to the group's banks ──────────────
    await expect(groupFilter).toContainText(COPY.groupAny);
    await groupFilter.click();
    await expect(
      page.getByRole('option', { name: tenant.group!.name, exact: true }),
      'the filter offers the student’s group',
    ).toHaveCount(1);
    await page.getByRole('option', { name: tenant.group!.name, exact: true }).click();
    await page.keyboard.press('Escape');

    await expect(groupFilter).toContainText(tenant.group!.name);
    await expect(
      page.locator('[data-slot="card"]'),
      'the group filter keeps only the banks shared with the group',
    ).toHaveCount(2);
    for (const spec of GROUP_BANKS) {
      await expect(
        bankCard(page, spec.name),
        `„${spec.name}” is shared with the group`,
      ).toBeVisible();
    }
    await expect(
      bankCard(page, OWN_BANK.name),
      'the student’s personal bank is outside the group',
    ).toHaveCount(0);

    // Clearing the group selection restores the placeholder and the full list.
    await groupFilter.click();
    await page.getByRole('option', { name: tenant.group!.name, exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(groupFilter).toContainText(COPY.groupAny);
    await expect(page.locator('[data-slot="card"]')).toHaveCount(3);

    // „Moje grupy” is the same selection in one click, then it disables itself.
    const mineGroups = page.getByRole('button', { name: COPY.groupMine, exact: true });
    await expect(mineGroups).toBeEnabled();
    await mineGroups.click();
    await expect(groupFilter).toContainText(tenant.group!.name);
    await expect(mineGroups, '„Moje grupy” is disabled while selected').toBeDisabled();
    await expect(page.locator('[data-slot="card"]')).toHaveCount(2);
    await expect(bankCard(page, OWN_BANK.name)).toHaveCount(0);

    // ── Adjacent regression: the retired „Grupy” scope stays rejected ───────
    const retired = await page.request.get('/api/v1/questions/banks?groupFilter=mine');
    expect(retired.status(), 'GET /api/v1/questions/banks?groupFilter=mine').toBe(422);
    const retiredBody = (await retired.json()) as { error?: string };
    expect(retiredBody.error).toBe('UNPROCESSABLE_ENTITY');

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });
});
