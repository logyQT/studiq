import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

/**
 * EDU-ASG-02 — Dodawanie pytań do kartkówki: ręczny wybór (`/edu/assignments/<id>`).
 *
 * Prerequisite (reconciled with the tenant seeder): a **draft** assignment owned by
 * the tenant's educator. The legacy manual account (`teacher1@dev.local`, password
 * `pass`) is never used.
 *
 * Tenant (deterministic, `content` profile, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts EDU-ASG-02 --fresh
 *
 * gives the org `qa-edu-asg-02-<suffix>` with a manager, an educator and a student,
 * plus the default group `G1`. Every id comes from the case's tenant key; nothing
 * global is read or written — no admin setting, feature flag, plan, platform stat
 * or singleton row. The banks, questions, topic and draft assignment are created
 * through the product API inside this tenant, so the spec owns all of its data.
 *
 * Acceptance points (confirmed on the shared app during the walk):
 * 1. An empty draft shows „Brak pytań” / „Dodaj pytania za pomocą przycisków
 *    poniżej”, and the „Pytania” / „Suma punktów” counters read 0.
 * 2. „Przeglądaj pytania” opens a dialog with the three sources — „Wszystkie
 *    pytania”, „Bank pytań”, „Temat” — a type select, the „Szukaj pytań...” field
 *    and the disabled „Dodaj wybrane (0)” footer action.
 * 3. The question list follows the source: all questions, only the chosen bank's
 *    questions, or only the chosen topic's questions.
 * 4. „Szukaj pytań...” narrows the list by content, case-insensitively.
 * 5. Selecting questions enables „Dodaj wybrane (n)”; adding them closes the
 *    dialog, lists them under „Pytania” and updates the „Pytania” /
 *    „Suma punktów” counters and the persisted assignment.
 * 6. Questions already in the assignment are no longer offered in the picker.
 */

const CASE = 'EDU-ASG-02';

/** Polish copy from `EduAssignmentDetailPage` (pl.json), as the UI renders it. */
const COPY = {
  browse: 'Przeglądaj pytania',
  sourceLabel: 'Wybierz źródło',
  sourceAll: 'Wszystkie pytania',
  sourceBank: 'Bank pytań',
  sourceTopic: 'Temat',
  search: 'Szukaj pytań...',
  addSelected: /^Dodaj wybrane/,
  back: 'Powrót do kartkówek',
  questions: 'Pytania',
  totalPoints: 'Suma punktów',
  emptyTitle: 'Brak pytań',
  emptyDesc: 'Dodaj pytania za pomocą przycisków poniżej',
  draft: 'Szkic',
} as const;

/** Tenant content, named after the case so every row is traceable. */
const BANK_A = 'EDU-ASG-02 Bank A';
const BANK_B = 'EDU-ASG-02 Bank B';
const TOPIC = 'EDU-ASG-02 Temat';

const QUESTION = {
  bankAOpen: 'EDU-ASG-02 A otwarte 1',
  bankATrueFalse: 'EDU-ASG-02 A PF 2',
  bankBOpen: 'EDU-ASG-02 B otwarte 1',
  bankBOpenSecond: 'EDU-ASG-02 B otwarte 2',
} as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface BankRow {
  id: string;
  name: string;
}

interface TopicRow {
  id: string;
  name: string;
}

interface QuestionRow {
  id: string;
  bank_id: string;
  content: string;
  type: 'mcq' | 'true_false' | 'open';
}

interface AssignmentDetail {
  id: string;
  title: string;
  status: 'draft' | 'published';
  question_count: number;
  total_points: number;
  assignment_questions: Array<{ question_id: string; points: number }>;
}

/** `GET` an endpoint as the signed-in user and unwrap the response envelope. */
async function getData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.ok(), `GET ${url} → ${response.status()} ${await response.text()}`).toBe(true);
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data;
}

/**
 * Create one of the case's question banks, or reuse it on a retry against an
 * already-seeded tenant (CI seeds once and retries the same tenant).
 */
async function ensureBank(page: Page, name: string): Promise<BankRow> {
  const banks = await getData<{ items: BankRow[] }>(page, '/api/v1/questions/banks?limit=100');
  const existing = banks.items.find((bank) => bank.name === name);
  if (existing) return existing;

  const response = await page.request.post('/api/v1/questions/banks', { data: { name } });
  expect(
    response.status(),
    `POST /api/v1/questions/banks (${name}) → ${response.status()} ${await response.text()}`,
  ).toBe(201);
  return ((await response.json()) as ApiEnvelope<BankRow>).data;
}

/** Create the case's topic, or reuse the one an earlier attempt left behind. */
async function ensureTopic(page: Page, name: string): Promise<TopicRow> {
  const topics = await getData<{ items: TopicRow[] }>(page, '/api/v1/topics?limit=200');
  const existing = topics.items.find((topic) => topic.name === name);
  if (existing) return existing;

  const response = await page.request.post('/api/v1/topics', { data: { name } });
  expect(
    response.status(),
    `POST /api/v1/topics (${name}) → ${response.status()} ${await response.text()}`,
  ).toBe(201);
  return ((await response.json()) as ApiEnvelope<TopicRow>).data;
}

/** Create a question inside the bank, keyed by its content so retries are idempotent. */
async function ensureQuestion(
  page: Page,
  bankId: string,
  content: string,
  data: {
    type: QuestionRow['type'];
    topicIds?: string[];
    answers?: Array<Record<string, unknown>>;
  },
): Promise<QuestionRow> {
  const questions = await getData<QuestionRow[]>(page, `/api/v1/questions?bankId=${bankId}`);
  const existing = questions.find((question) => question.content === content);
  if (existing) return existing;

  const response = await page.request.post('/api/v1/questions', {
    data: { bankId, content, ...data },
  });
  expect(
    response.status(),
    `POST /api/v1/questions (${content}) → ${response.status()} ${await response.text()}`,
  ).toBe(201);
  return ((await response.json()) as ApiEnvelope<QuestionRow>).data;
}

/** A fresh draft per run, so the empty-state assertions never see a previous run. */
async function createDraft(page: Page): Promise<string> {
  const title = `EDU-ASG-02 Szkic ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const response = await page.request.post('/api/v1/teacher/assignments', { data: { title } });
  expect(
    response.status(),
    `POST /api/v1/teacher/assignments → ${response.status()} ${await response.text()}`,
  ).toBe(201);
  return ((await response.json()) as ApiEnvelope<AssignmentDetail>).data.id;
}

/** One of the three counters above the question list („Pytania”, „Suma punktów”, …). */
function statCard(page: Page, label: string): Locator {
  return page
    .locator('[data-slot="card"]')
    .filter({ has: page.locator('[data-slot="card-title"]', { hasText: label }) })
    .filter({ has: page.locator('p.text-2xl') })
    .first();
}

/** The browse dialog — the only dialog this case opens. */
function browseDialog(page: Page): Locator {
  return page.locator('[data-slot="dialog-content"]');
}

/** The question rows of the browse dialog (each is a `<label>` with a checkbox). */
function browseRows(dialog: Locator): Locator {
  return dialog.locator('label:has(> input[type="checkbox"])');
}

/** Question contents currently listed in the browse dialog. */
async function browseContents(dialog: Locator): Promise<string[]> {
  const rows = await browseRows(dialog).allInnerTexts();
  return rows.map((row) => row.split('\n')[0].trim()).sort();
}

/** The source-specific bank/topic select (rendered before the always-present type select). */
function sourceSelect(dialog: Locator): Locator {
  return dialog.locator('select').first();
}

/** Tick a question in the browse dialog and prove the checkbox registered. */
async function selectQuestion(dialog: Locator, content: string): Promise<void> {
  const row = browseRows(dialog).filter({ hasText: content });
  await expect(row, `„${content}” is offered in the picker`).toHaveCount(1);
  await row.click();
  await expect(row.locator('input[type="checkbox"]')).toBeChecked();
}

test.describe('@case:EDU-ASG-02 @area:EDU @prio:P2 assignment manual question picker', () => {
  test('browses by source, filters by bank/topic/search and adds the selected questions', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    expect(tenant.users.teacher, `${CASE} needs the seeded educator`).toBeTruthy();

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await loginAs(page, tenant, 'teacher', { locale: 'pl' });
    expect(new URL(page.url()).pathname, 'educator lands on /edu').toBe('/edu');

    // ── Prerequisite: a draft assignment and the tenant's own question content ──
    const bankA = await ensureBank(page, BANK_A);
    const bankB = await ensureBank(page, BANK_B);
    const topic = await ensureTopic(page, TOPIC);

    const bankAOpen = await ensureQuestion(page, bankA.id, QUESTION.bankAOpen, {
      type: 'open',
      topicIds: [topic.id],
    });
    await ensureQuestion(page, bankA.id, QUESTION.bankATrueFalse, {
      type: 'true_false',
      answers: [
        { content: 'Prawda', isCorrect: true, orderIndex: 0 },
        { content: 'Fałsz', isCorrect: false, orderIndex: 1 },
      ],
    });
    await ensureQuestion(page, bankB.id, QUESTION.bankBOpen, {
      type: 'open',
      topicIds: [topic.id],
    });
    const bankBOpenSecond = await ensureQuestion(page, bankB.id, QUESTION.bankBOpenSecond, {
      type: 'open',
    });

    const assignmentId = await createDraft(page);

    // ── Empty draft: the case's third expected result ───────────────────────
    await page.goto(`/edu/assignments/${assignmentId}`);
    await expect(page).toHaveURL(new RegExp(`/edu/assignments/${assignmentId}$`));
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
    await expect(page.getByText(COPY.draft, { exact: true })).toBeVisible();

    await expect(page.getByText(COPY.emptyTitle, { exact: true })).toBeVisible();
    await expect(page.getByText(COPY.emptyDesc, { exact: true })).toBeVisible();
    await expect(statCard(page, COPY.questions).locator('p.text-2xl')).toHaveText('0');
    await expect(statCard(page, COPY.totalPoints).locator('p.text-2xl')).toHaveText('0');

    // ── Step 1a: „Wszystkie pytania” lists every question ───────────────────
    const dialog = browseDialog(page);
    await page.getByRole('button', { name: COPY.browse }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: COPY.browse })).toBeVisible();
    await expect(dialog.getByText(COPY.sourceLabel, { exact: true })).toBeVisible();

    for (const source of [COPY.sourceAll, COPY.sourceBank, COPY.sourceTopic]) {
      await expect(dialog.getByRole('radio', { name: source }), `source „${source}”`).toBeVisible();
    }
    await expect(dialog.getByRole('radio', { name: COPY.sourceAll })).toBeChecked();
    await expect(dialog.getByPlaceholder(COPY.search)).toBeVisible();

    const addSelected = dialog.getByRole('button', { name: COPY.addSelected });
    await expect(addSelected).toHaveText('Dodaj wybrane (0)');
    await expect(addSelected).toBeDisabled();

    const allQuestions = [
      QUESTION.bankAOpen,
      QUESTION.bankATrueFalse,
      QUESTION.bankBOpen,
      QUESTION.bankBOpenSecond,
    ];
    await expect
      .poll(() => browseContents(dialog), { timeout: 15_000, message: 'all questions' })
      .toEqual([...allQuestions].sort());

    // ── Step 1b: „Bank pytań” + the chosen bank narrows the list ────────────
    await dialog.getByRole('radio', { name: COPY.sourceBank }).check();
    const bankSelect = sourceSelect(dialog);
    await expect(bankSelect).toBeVisible();
    await expect(bankSelect.locator('option').first()).toHaveText('Wybierz bank...');
    await expect(bankSelect.locator('option')).toHaveCount(3); // placeholder + both banks
    await bankSelect.selectOption({ label: BANK_A });

    await expect
      .poll(() => browseContents(dialog), { timeout: 15_000, message: 'bank A questions' })
      .toEqual([QUESTION.bankAOpen, QUESTION.bankATrueFalse].sort());

    // ── Step 1c: „Temat” + the chosen topic narrows the list ────────────────
    await dialog.getByRole('radio', { name: COPY.sourceTopic }).check();
    const topicSelect = sourceSelect(dialog);
    await expect(topicSelect).toBeVisible();
    await expect(topicSelect.locator('option').first()).toHaveText('Wybierz temat...');
    await topicSelect.selectOption({ label: TOPIC });

    await expect
      .poll(() => browseContents(dialog), { timeout: 15_000, message: 'topic questions' })
      .toEqual([QUESTION.bankAOpen, QUESTION.bankBOpen].sort());

    // ── Step 3: the search field filters by content ─────────────────────────
    await dialog.getByRole('radio', { name: COPY.sourceAll }).check();
    const search = dialog.getByPlaceholder(COPY.search);
    await search.fill('PF');
    await expect
      .poll(() => browseContents(dialog), { timeout: 15_000, message: 'search „PF”' })
      .toEqual([QUESTION.bankATrueFalse]);

    await search.fill('');
    await expect
      .poll(() => browseContents(dialog), { timeout: 15_000, message: 'cleared search' })
      .toEqual([...allQuestions].sort());

    // ── Step 2: select two questions and add them to the assignment ─────────
    await selectQuestion(dialog, QUESTION.bankAOpen);
    await selectQuestion(dialog, QUESTION.bankBOpenSecond);
    await expect(addSelected).toHaveText('Dodaj wybrane (2)');
    await expect(addSelected).toBeEnabled();
    await addSelected.click();

    await expect(dialog).toHaveCount(0);

    // ── Expected result: the list and the „Suma punktów” counter ────────────
    await expect(statCard(page, COPY.questions).locator('p.text-2xl')).toHaveText('2');
    await expect(statCard(page, COPY.totalPoints).locator('p.text-2xl')).toHaveText('2');
    await expect(page.getByText(COPY.emptyTitle, { exact: true })).toHaveCount(0);
    await expect(page.getByText(COPY.emptyDesc, { exact: true })).toHaveCount(0);

    const listCard = page
      .locator('[data-slot="card"]')
      .filter({ has: page.locator('[data-slot="card-title"]', { hasText: COPY.questions }) })
      .filter({ hasText: QUESTION.bankAOpen })
      .first();
    await expect(listCard, 'the „Pytania” section lists the added question').toBeVisible();
    await expect(listCard).toContainText(QUESTION.bankBOpenSecond);

    // The same assignment as the API returns it, so the UI is not the only witness.
    const detail = await getData<AssignmentDetail>(
      page,
      `/api/v1/teacher/assignments/${assignmentId}`,
    );
    expect(detail.status, 'the assignment stays a draft').toBe('draft');
    expect(detail.question_count, 'persisted question count').toBe(2);
    expect(detail.total_points, 'persisted point sum').toBe(2);
    expect(
      detail.assignment_questions.map((question) => question.question_id).sort(),
      'the two picked questions are stored in the assignment',
    ).toEqual([bankAOpen.id, bankBOpenSecond.id].sort());

    // ── Adjacent regression: already-added questions leave the picker ───────
    await page.getByRole('button', { name: COPY.browse }).click();
    await expect(dialog).toBeVisible();
    await expect
      .poll(() => browseContents(dialog), { timeout: 15_000, message: 'picker after adding' })
      .toEqual([QUESTION.bankATrueFalse, QUESTION.bankBOpen].sort());

    await dialog.getByRole('button', { name: COPY.back }).click();
    await expect(dialog).toHaveCount(0);

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });
});
