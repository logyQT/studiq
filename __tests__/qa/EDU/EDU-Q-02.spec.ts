import { expect, test, type APIResponse, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * EDU-Q-02 — Pytanie wielokrotnego wyboru (/edu/questions/<bankId>).
 *
 * Case (verbatim → tenant model): with the bank „Fizyka” open, click „Utwórz
 * pytanie”, pick type „Wielokrotny wybór”, type the content, add four answers with
 * „Dodaj odpowiedź”, mark the correct one with the radio, add an explanation and a
 * topic, then save. The question appears in the table with the type
 * „Wielokrotnego wyboru”, its answer count and its topic, and exactly one answer is
 * marked correct. The case's legacy accounts (`teacher1@dev.local`, password `pass`)
 * are never used.
 *
 * Tenant (`content` profile — org + manager/teacher/student + default group `G1`,
 * declared in `__tests__/qa/profiles/EDU-Q-02.json`), fresh run suffix per independent
 * run:
 *
 *   bun scripts/qa-tenant.ts EDU-Q-02 --fresh
 *
 * gives `qa-edu-q-02-<suffix>` (`tenantKey('qa/cases/EDU-Q-02.md',
 * 'EDU-Q-02#<suffix>', 'qa-shared')` + `tenantId` for every org/user/group id).
 * The tenant's `teacher` is an educator and an org member, so it may create its own
 * question bank and questions (`question_bank.*` / `question.*` = `own`). The
 * case's two prerequisites — the bank „Fizyka” and a topic to attach — are built
 * through the product API inside this tenant, idempotently, so a retry against the
 * same tenant does not duplicate them; the question itself is created through the
 * UI, exactly as the case walks it. Nothing global is read or written: no admin
 * setting, feature flag, plan, platform stat or singleton row, and no other
 * worker's tenant.
 *
 * Acceptance points (walked on the shared app, worker qa-env-2, before writing):
 * 1. „Utwórz pytanie” opens the dialog „Utwórz pytanie” / „Dodaj nowe pytanie do
 *    tego banku” with type „Wielokrotny wybór”, a content textarea, an answer list
 *    starting at „Odpowiedź 1”, „Dodaj odpowiedź”, an explanation textarea and the
 *    topic multi-select „Wybierz tematy...”.
 * 2. „Utwórz” answers the toast „Pytanie utworzone” and closes the dialog.
 * 3. The table row shows the content, the type badge „Wielokrotnego wyboru”, the
 *    topic badge „Kinematyka” and the answer count `4`.
 * 4. The stored question is `type: 'mcq'` with exactly four answers and exactly one
 *    `is_correct` (the answer marked by the radio), plus the explanation and the
 *    topic assignment.
 * 5. The edit dialog reopens the stored state: four radios, only the correct one
 *    checked, the explanation and the topic chip preserved.
 */

const CASE = 'EDU-Q-02';

const BANK_NAME = 'Fizyka';
const BANK_DESCRIPTION = 'Dział: kinematyka';
const TOPIC_NAME = 'Kinematyka';
const QUESTION_CONTENT = 'Ile wynosi przyspieszenie ziemskie?';
const EXPLANATION = 'Przyspieszenie ziemskie wynosi około 9,81 m/s².';
const ANSWERS = ['9,81 m/s²', '3,14 m/s²', '1,62 m/s²', '0 m/s²'] as const;
/** Index of the answer the case marks with the radio. */
const CORRECT_INDEX = 0;

/** Polish copy the case quotes, as the current product renders it. */
const COPY = {
  createQuestion: 'Utwórz pytanie',
  dialogDescription: 'Dodaj nowe pytanie do tego banku',
  questionType: 'Typ pytania',
  typeMcq: 'Wielokrotny wybór',
  contentPlaceholder: 'Wpisz swoje pytanie...',
  answersLabel: 'Odpowiedzi',
  addAnswer: 'Dodaj odpowiedź',
  explanationPlaceholder: 'Wyjaśnij, dlaczego odpowiedź jest poprawna...',
  topicsPlaceholder: 'Wybierz tematy...',
  create: 'Utwórz',
  created: 'Pytanie utworzone',
  editTitle: 'Edytuj pytanie',
  editAction: 'Edytuj',
  cancel: 'Anuluj',
  manageBank: 'Zarządzaj',
  typeBadge: 'Wielokrotnego wyboru',
  emptyBank: 'Brak pytań w tym banku. Utwórz swoje pierwsze pytanie!',
} as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface BankListItem {
  id: string;
  name: string;
  description: string | null;
  organization_id: string | null;
}

interface BankListResult {
  items: BankListItem[];
}

interface TopicListItem {
  id: string;
  name: string;
}

interface TopicListResult {
  items: TopicListItem[];
}

interface StoredAnswer {
  id: string;
  content: string;
  is_correct: boolean;
  order_index: number;
}

interface StoredQuestion {
  id: string;
  bank_id: string;
  organization_id: string | null;
  type: 'mcq' | 'true_false' | 'open';
  content: string;
  explanation: string | null;
  question_answers: StoredAnswer[];
  topics?: Array<{ id: string; name: string }>;
}

function account(tenant: QaTenant) {
  const user = tenant.users.teacher;
  if (!user) {
    throw new Error(
      `EDU-Q-02 fixture incomplete: no teacher. Run \`bun scripts/qa-tenant.ts ${CASE} --fresh\``,
    );
  }
  return user;
}

async function expectApi<T>(response: APIResponse, label: string): Promise<T> {
  expect(response.status(), label).toBeLessThan(300);
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(body.success, `${label} response`).toBe(true);
  return body.data;
}

/**
 * The case's prerequisite „Bank Fizyka”. Idempotent so the CI retry budget
 * (`--retries=2` against the tenant seeded once) never creates a second bank.
 */
async function ensureBank(page: Page): Promise<BankListItem> {
  const list = await expectApi<BankListResult>(
    await page.request.get('/api/v1/questions/banks?limit=100'),
    'GET /api/v1/questions/banks',
  );
  const existing = list.items.find((bank) => bank.name === BANK_NAME);
  if (existing) return existing;

  return expectApi<BankListItem>(
    await page.request.post('/api/v1/questions/banks', {
      data: { name: BANK_NAME, description: BANK_DESCRIPTION },
    }),
    'POST /api/v1/questions/banks',
  );
}

/**
 * The case's step 3 needs a topic to attach. An educator's topics default to
 * `visibility: 'group'`; the author still reads it through the org+creator scope,
 * so the picker offers it. Idempotent for the same reason as `ensureBank`.
 */
async function ensureTopic(page: Page): Promise<TopicListItem> {
  const list = await expectApi<TopicListResult>(
    await page.request.get('/api/v1/topics?limit=200'),
    'GET /api/v1/topics',
  );
  const existing = list.items.find((topic) => topic.name === TOPIC_NAME);
  if (existing) return existing;

  return expectApi<TopicListItem>(
    await page.request.post('/api/v1/topics', { data: { name: TOPIC_NAME } }),
    'POST /api/v1/topics',
  );
}

/**
 * A retry against the same tenant must start from the same state: drop this
 * spec's own question (tenant-local, addressed by its content) so the table has
 * exactly one row and the empty state is real before the walk.
 */
async function removePreviousQuestions(page: Page, bankId: string): Promise<void> {
  const questions = await expectApi<StoredQuestion[]>(
    await page.request.get(`/api/v1/questions?bankId=${bankId}`),
    'GET /api/v1/questions',
  );
  for (const question of questions.filter((row) => row.content === QUESTION_CONTENT)) {
    const response = await page.request.delete(`/api/v1/questions/${question.id}`);
    expect(
      response.status(),
      `DELETE /api/v1/questions/${question.id} → ${response.status()} ${await response.text()}`,
    ).toBeLessThan(300);
  }
}

/** The bank card on /edu/questions, addressed by its own heading. */
function bankCard(page: Page, name: string): Locator {
  return page
    .locator('main [data-slot="card"]')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });
}

/** The single table row of the created question, addressed by its content. */
function questionRow(page: Page): Locator {
  return page.locator('table tbody tr').filter({ hasText: QUESTION_CONTENT });
}

function dialog(page: Page): Locator {
  return page.locator('[data-slot="dialog-content"]');
}

function answerInputs(page: Page): Locator {
  return dialog(page).locator('input[data-slot="input"]');
}

function answerRadios(page: Page): Locator {
  return dialog(page).locator('input[name="correctAnswer"]');
}

test.describe('@case:EDU-Q-02 @area:EDU @prio:P1 multiple-choice question', () => {
  test('creates a four-answer MCQ with one correct answer, a topic and an explanation', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const tenant = loadTenant(CASE);
    console.log(`EDU-Q-02 tenant key: ${tenant.key}`);
    account(tenant);

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // --- Prerequisites: the tenant's „Fizyka” bank and a topic -----------------
    await loginAs(page, tenant, 'teacher', { locale: 'pl' });
    expect(new URL(page.url()).pathname, 'educator lands on /edu').toBe('/edu');

    const bank = await ensureBank(page);
    expect(bank.organization_id, 'the bank belongs to the tenant organization').toBe(
      tenant.org?.id,
    );
    const topic = await ensureTopic(page);
    await removePreviousQuestions(page, bank.id);

    // --- Step 1: open the bank, click „Utwórz pytanie”, type „Wielokrotny wybór”
    await page.goto('/edu/questions');
    await expect(page).toHaveURL(/\/edu\/questions$/);
    const card = bankCard(page, BANK_NAME);
    await expect(card, 'the „Fizyka” bank card').toBeVisible();
    await card.getByRole('button', { name: COPY.manageBank, exact: true }).click();
    await page.waitForURL(new RegExp(`/edu/questions/${bank.id}$`), { timeout: 20_000 });
    await expect(
      page.getByRole('heading', { level: 2, name: BANK_NAME, exact: true }),
    ).toBeVisible();
    await expect(page.getByText(COPY.emptyBank, { exact: true })).toBeVisible();

    await page.getByRole('button', { name: COPY.createQuestion, exact: true }).click();
    const form = dialog(page);
    await expect(form).toBeVisible();
    await expect(
      form.getByRole('heading', { name: COPY.createQuestion, exact: true }),
    ).toBeVisible();
    await expect(form.getByText(COPY.dialogDescription, { exact: true })).toBeVisible();

    // The type select offers exactly the three question types and defaults to MCQ;
    // the case's step picks „Wielokrotny wybór” explicitly.
    await form.locator('[data-slot="select-trigger"]').click();
    await expect(page.getByRole('option')).toHaveCount(3);
    await page.getByRole('option', { name: COPY.typeMcq, exact: true }).click();
    await expect(form.locator('[data-slot="select-trigger"]')).toContainText(COPY.typeMcq);

    // --- Step 2: content, four answers, the correct radio, explanation, topic --
    await form.locator(`textarea[placeholder="${COPY.contentPlaceholder}"]`).fill(QUESTION_CONTENT);

    await expect(answerInputs(page), 'the form starts with one answer row').toHaveCount(1);
    await answerInputs(page).nth(0).fill(ANSWERS[0]);
    for (let index = 1; index < ANSWERS.length; index += 1) {
      await form.getByRole('button', { name: COPY.addAnswer, exact: true }).click();
      await expect(answerInputs(page), `answer rows after ${index} additions`).toHaveCount(
        index + 1,
      );
      await answerInputs(page).nth(index).fill(ANSWERS[index]);
    }

    await expect(answerRadios(page), 'one radio per answer').toHaveCount(ANSWERS.length);
    await answerRadios(page).nth(CORRECT_INDEX).check();
    await expect(answerRadios(page).nth(CORRECT_INDEX)).toBeChecked();

    await form.locator(`textarea[placeholder="${COPY.explanationPlaceholder}"]`).fill(EXPLANATION);

    await form.locator('button[data-slot="popover-trigger"]').click();
    const topicOptions = page.locator('[data-slot="popover-content"] [role="option"]');
    await expect(topicOptions, 'the picker offers the tenant topic').toHaveCount(1);
    await expect(topicOptions.first()).toHaveText(TOPIC_NAME);
    await page.getByRole('option', { name: TOPIC_NAME, exact: true }).click();
    // The multi-select keeps its popover open after a pick; the dialog title closes
    // it without touching the rest of the form.
    await form.getByRole('heading', { name: COPY.createQuestion, exact: true }).click();
    await expect(page.locator('[data-slot="popover-content"]')).toHaveCount(0);
    await expect(form.locator('button[data-slot="popover-trigger"]')).toContainText(TOPIC_NAME);

    // --- Step 3: save ----------------------------------------------------------
    await form.getByRole('button', { name: COPY.create, exact: true }).click();
    await expect(page.getByText(COPY.created, { exact: true }).first()).toBeVisible();
    await expect(dialog(page), 'the dialog closes on success').toHaveCount(0);

    // --- Expected result: the table row ----------------------------------------
    await expect(questionRow(page), 'exactly one row for the new question').toHaveCount(1);
    const cells = questionRow(page).locator('td');
    await expect(cells.nth(0), 'Pytanie').toHaveText(QUESTION_CONTENT);
    await expect(cells.nth(1), 'Typ').toHaveText(COPY.typeBadge);
    await expect(cells.nth(2), 'Tematy').toHaveText(TOPIC_NAME);
    await expect(cells.nth(3), 'Odpowiedzi').toHaveText(String(ANSWERS.length));

    // --- Expected result: the stored question and its single correct answer ----
    const stored = await expectApi<StoredQuestion[]>(
      await page.request.get(`/api/v1/questions?bankId=${bank.id}`),
      'GET /api/v1/questions',
    );
    const created = stored.filter((row) => row.content === QUESTION_CONTENT);
    expect(created, 'the bank stores exactly this question').toHaveLength(1);
    const question = created[0];
    expect(question.type, 'question type').toBe('mcq');
    expect(question.organization_id, 'question organization').toBe(tenant.org?.id);
    expect(question.explanation, 'the explanation is stored').toBe(EXPLANATION);
    expect(
      question.topics?.map((row) => row.name),
      'the topic assignment is stored',
    ).toEqual([TOPIC_NAME]);
    expect(
      question.question_answers.map((answer) => answer.content),
      'the answers keep their order',
    ).toEqual([...ANSWERS]);

    const correct = question.question_answers.filter((answer) => answer.is_correct);
    expect(correct, 'exactly one answer is marked correct').toHaveLength(1);
    expect(correct[0].content, 'the radio marked the first answer').toBe(ANSWERS[CORRECT_INDEX]);
    expect(correct[0].order_index, 'the correct answer keeps its position').toBe(CORRECT_INDEX);
    expect(topic.id, 'the attached topic is the tenant topic').toBeTruthy();

    // --- Adjacent path: the edit dialog round-trips the stored state -----------
    await questionRow(page).getByRole('button', { name: COPY.editAction, exact: true }).click();
    const editForm = dialog(page);
    await expect(editForm).toBeVisible();
    await expect(
      editForm.getByRole('heading', { name: COPY.editTitle, exact: true }),
    ).toBeVisible();

    await expect(answerInputs(page), 'the edit dialog shows all four answers').toHaveCount(
      ANSWERS.length,
    );
    await expect(answerInputs(page).nth(0)).toHaveValue(ANSWERS[0]);
    await expect(answerInputs(page).nth(3)).toHaveValue(ANSWERS[3]);
    await expect(answerRadios(page), 'one radio per answer').toHaveCount(ANSWERS.length);
    for (let index = 0; index < ANSWERS.length; index += 1) {
      if (index === CORRECT_INDEX) {
        await expect(answerRadios(page).nth(index), 'the correct radio').toBeChecked();
      } else {
        await expect(answerRadios(page).nth(index), 'a distractor radio').not.toBeChecked();
      }
    }
    await expect(
      editForm.locator(`textarea[placeholder="${COPY.explanationPlaceholder}"]`),
    ).toHaveValue(EXPLANATION);
    await expect(editForm.locator('button[data-slot="popover-trigger"]')).toContainText(TOPIC_NAME);

    await editForm.getByRole('button', { name: COPY.cancel, exact: true }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(questionRow(page), 'cancelling keeps the question').toHaveCount(1);

    expect(pageErrors, 'uncaught page errors during the walk').toEqual([]);
  });
});
