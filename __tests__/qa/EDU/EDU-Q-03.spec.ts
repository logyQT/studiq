import { expect, test, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * EDU-Q-03 — Prawda/Fałsz question in a question bank (/edu/questions/<bank>).
 *
 * Case (verbatim → tenant model): a teacher opens the bank „Fizyka”, clicks
 * „Utwórz pytanie”, picks the type „Prawda / Fałsz”, marks the correct answer and
 * saves. Expected: two options „Prawda” and „Fałsz” exist and the saved question
 * has type P/F. The case's legacy account (`teacher1@dev.local`, password `pass`)
 * is never used.
 *
 * Product note confirmed during the walk (worker qa-env-6, shared app): the case's
 * step 1 names a „Generuj opcje Prawda/Fałsz” button, but the product seeds both
 * options as soon as the type is switched to „Prawda / Fałsz” — there is no extra
 * generate click (the `QuestionForm.generate_tf` copy is unused). The expected
 * result is unchanged: two options appear and the stored question is `true_false`.
 * The spec asserts that outcome, not the retired button.
 *
 * Tenant: `tenantKey('qa/cases/EDU-Q-03.md', 'EDU-Q-03#<run suffix>', 'qa-shared')`
 * from the case's own profile (`content`): one organization, default group `G1`,
 * and `manager` / `teacher` / `student`. The bank belongs to the teacher (org role
 * `member`, so its `question_bank.*` scope is `own`); nothing global — admin
 * settings, feature flags, plans, platform stats, singleton rows — is read or
 * written, and no other worker's tenant is touched.
 *
 * The spec is idempotent against one seeded tenant: the prerequisite bank is
 * reused or created through the product API, and a question left by an earlier run
 * with the same content is deleted before the walk, so a retry starts from an
 * empty bank.
 *
 * Acceptance points (walked on the shared app before writing):
 * 1. Choosing „Prawda / Fałsz” immediately renders exactly two answer rows,
 *    „Prawda” and „Fałsz”, with „Prawda” preselected as the correct one; the
 *    binary type offers neither „Dodaj odpowiedź” nor a remove-answer action.
 * 2. Marking „Fałsz” and saving answers „Pytanie utworzone”; the table row shows
 *    the type „Prawda / Fałsz”, `2` answers and no topic.
 * 3. The stored question is `type: 'true_false'` with exactly two answers in
 *    order „Prawda” (incorrect), „Fałsz” (correct) — exactly one correct answer.
 * 4. Reopening the question shows type P/F and both options with „Fałsz” checked;
 *    the type filter keeps the row under „Prawda / Fałsz” and hides it under
 *    „Otwarte”.
 */

const CASE = 'EDU-Q-03';

const BANKS_URL = '/api/v1/questions/banks';
const QUESTIONS_URL = '/api/v1/questions';

/** The case's prerequisite bank and the question it creates. */
const BANK_NAME = 'Fizyka';
const QUESTION_CONTENT = 'Przyspieszenie ziemskie wynosi około 9,81 m/s².';

/** Polish copy the case quotes, as the current product renders it. */
const COPY = {
  manage: 'Zarządzaj',
  createQuestion: 'Utwórz pytanie',
  createTitle: 'Utwórz pytanie',
  editTitle: 'Edytuj pytanie',
  mcq: 'Wielokrotny wybór',
  trueFalse: 'Prawda / Fałsz',
  /** Filter label for `open` in `QuestionBankDetail` (the form says „Otwarta odpowiedź”). */
  filterOpen: 'Otwarte',
  contentPlaceholder: 'Wpisz swoje pytanie...',
  answer1: 'Odpowiedź 1',
  answer2: 'Odpowiedź 2',
  trueLabel: 'Prawda',
  falseLabel: 'Fałsz',
  addAnswer: 'Dodaj odpowiedź',
  create: 'Utwórz',
  cancel: 'Anuluj',
  created: 'Pytanie utworzone',
  allTypes: 'Wszystkie',
  noQuestions: 'Brak pytań w tym banku. Utwórz swoje pierwsze pytanie!',
  edit: 'Edytuj',
} as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface BankListItem {
  id: string;
  name: string;
  question_count: number;
}

interface BankListResult {
  items: BankListItem[];
}

interface QuestionAnswer {
  content: string;
  is_correct: boolean;
  order_index: number;
}

interface Question {
  id: string;
  type: string;
  content: string;
  bank_id: string;
  question_answers: QuestionAnswer[];
}

async function getData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.ok(), `GET ${url} → ${response.status()} ${await response.text()}`).toBe(true);
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data;
}

async function listBanks(page: Page): Promise<BankListItem[]> {
  return (await getData<BankListResult>(page, `${BANKS_URL}?limit=100`)).items;
}

async function listQuestions(page: Page, bankId: string): Promise<Question[]> {
  return getData<Question[]>(page, `${QUESTIONS_URL}?bankId=${bankId}`);
}

/**
 * The case's prerequisite bank „Fizyka”. Reuse the tenant's own bank when a run
 * already created it, otherwise create it through the same API the dialog uses.
 */
async function ensureBank(page: Page): Promise<BankListItem> {
  const existing = (await listBanks(page)).find((bank) => bank.name === BANK_NAME);
  if (existing) return existing;

  const response = await page.request.post(BANKS_URL, { data: { name: BANK_NAME } });
  expect(
    response.status(),
    `POST ${BANKS_URL} (${BANK_NAME}) → ${response.status()} ${await response.text()}`,
  ).toBe(201);
  const body = (await response.json()) as ApiEnvelope<BankListItem>;
  expect(body.success, `POST ${BANKS_URL} (${BANK_NAME}) success flag`).toBe(true);
  return body.data;
}

/** Start from an empty bank: a retry must not see the question of the previous run. */
async function removeQuestionsWithContent(page: Page, bankId: string): Promise<void> {
  for (const question of await listQuestions(page, bankId)) {
    if (question.content !== QUESTION_CONTENT) continue;
    const response = await page.request.delete(`${QUESTIONS_URL}/${question.id}`);
    expect(
      response.ok(),
      `DELETE ${QUESTIONS_URL}/${question.id} → ${response.status()} ${await response.text()}`,
    ).toBe(true);
  }
}

/** The question row, addressed by its own content so no sibling matches. */
function questionRow(page: Page) {
  return page.locator('table tbody tr').filter({ hasText: QUESTION_CONTENT });
}

/**
 * Pick one value in the type filter. Radix keeps the listbox in the DOM while it
 * closes, so the next open must wait for it to be gone before clicking again.
 */
async function chooseTypeFilter(page: Page, label: string): Promise<void> {
  const filter = page.getByRole('combobox');
  await filter.click();
  await page.getByRole('option', { name: label, exact: true }).click();
  await expect(page.locator('[data-slot="select-content"]')).toHaveCount(0);
  await expect(filter).toContainText(label);
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

test.describe('@case:EDU-Q-03 @area:EDU @prio:P2 true/false question', () => {
  test('creates a Prawda/Fałsz question with exactly two options and one correct answer', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const { pageErrors, failedDocuments } = watchPage(page);

    const tenant: QaTenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} runs on the content tenant`).toBe('content');
    expect(tenant.users.teacher, `${CASE} needs the seeded educator`).toBeTruthy();

    await loginAs(page, tenant, 'teacher', { locale: 'pl' });
    expect(new URL(page.url()).pathname, 'educator lands on /edu').toBe('/edu');

    // --- Prerequisite: the tenant's „Fizyka” bank, empty of this case's question ---
    const bank = await ensureBank(page);
    await removeQuestionsWithContent(page, bank.id);

    // --- Step 1: open the bank and the create-question dialog -----------------
    await page.goto('/edu/questions');
    await expect(page).toHaveURL(/\/edu\/questions$/);

    const bankCard = page
      .locator('main [data-slot="card"]')
      .filter({ has: page.getByRole('heading', { name: BANK_NAME, exact: true }) });
    await expect(bankCard, 'the „Fizyka” bank is listed').toBeVisible();
    await bankCard.getByRole('button', { name: COPY.manage }).click();
    await expect(page).toHaveURL(new RegExp(`/edu/questions/${bank.id}$`));
    await expect(page.getByRole('heading', { name: BANK_NAME, exact: true })).toBeVisible();
    await expect(
      page.getByText(COPY.noQuestions, { exact: true }),
      'the bank starts empty',
    ).toBeVisible();

    await page.getByRole('button', { name: COPY.createQuestion }).click();
    const dialog = page.locator('[data-slot="dialog-content"]');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: COPY.createTitle })).toBeVisible();

    // The default type is a multiple-choice question; switch to Prawda/Fałsz.
    const typeSelect = dialog.locator('[data-slot="select-trigger"]');
    await expect(typeSelect).toContainText(COPY.mcq);
    await typeSelect.click();
    await page.getByRole('option', { name: COPY.trueFalse, exact: true }).click();
    await expect(typeSelect).toContainText(COPY.trueFalse);

    // 1. Both options are there immediately, in order, with „Prawda” preselected.
    const answer1 = dialog.getByPlaceholder(COPY.answer1);
    const answer2 = dialog.getByPlaceholder(COPY.answer2);
    await expect(answer1).toHaveValue(COPY.trueLabel);
    await expect(answer2).toHaveValue(COPY.falseLabel);

    const radios = dialog.locator('input[type="radio"]');
    await expect(radios).toHaveCount(2);
    await expect(radios.nth(0), '„Prawda” is the default correct answer').toBeChecked();
    await expect(radios.nth(1)).not.toBeChecked();

    // A binary question cannot grow or lose options.
    await expect(dialog.getByRole('button', { name: COPY.addAnswer })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: /Usuń odpowiedź/ })).toHaveCount(0);

    // --- Step 2: content, mark „Fałsz” as correct, save -----------------------
    await dialog.getByPlaceholder(COPY.contentPlaceholder).fill(QUESTION_CONTENT);
    await radios.nth(1).check();
    await expect(radios.nth(1)).toBeChecked();
    await expect(radios.nth(0)).not.toBeChecked();

    await dialog.getByRole('button', { name: COPY.create }).click();

    await expect(page.getByText(COPY.created, { exact: true }).first()).toBeVisible();
    await expect(page.locator('[data-slot="dialog-content"]')).toHaveCount(0);

    // 2. The row shows the P/F type, two answers and no topic.
    const row = questionRow(page);
    await expect(row).toHaveCount(1);
    await expect(row).toBeVisible();
    await expect(row.getByText(COPY.trueFalse, { exact: true })).toHaveCount(1);
    await expect(row.locator('td').nth(3), 'the answer count').toHaveText('2');
    await expect(row.locator('td').nth(2), 'no topic is set').toHaveText('—');

    // 3. The stored question: true_false, Prawda/Fałsz, exactly one correct.
    const matches = (await listQuestions(page, bank.id)).filter(
      (question) => question.content === QUESTION_CONTENT,
    );
    expect(matches, 'exactly one question carries the case content').toHaveLength(1);
    const saved = matches[0];
    expect(saved.type, 'the saved type is P/F').toBe('true_false');
    expect(saved.bank_id, 'the question belongs to „Fizyka”').toBe(bank.id);

    const answers = [...saved.question_answers].sort((a, b) => a.order_index - b.order_index);
    expect(
      answers.map((answer) => ({ content: answer.content, isCorrect: answer.is_correct })),
      'both options are stored, in order, with „Fałsz” correct',
    ).toEqual([
      { content: COPY.trueLabel, isCorrect: false },
      { content: COPY.falseLabel, isCorrect: true },
    ]);
    expect(
      answers.filter((answer) => answer.is_correct),
      'exactly one correct answer',
    ).toHaveLength(1);

    // 4a. Reopening the question restores the type and the marked option.
    await row.getByRole('button', { name: COPY.edit }).click();
    const editDialog = page.locator('[data-slot="dialog-content"]');
    await expect(editDialog.getByRole('heading', { name: COPY.editTitle })).toBeVisible();
    await expect(editDialog.locator('[data-slot="select-trigger"]')).toContainText(COPY.trueFalse);
    await expect(editDialog.getByPlaceholder(COPY.answer1)).toHaveValue(COPY.trueLabel);
    await expect(editDialog.getByPlaceholder(COPY.answer2)).toHaveValue(COPY.falseLabel);
    const editRadios = editDialog.locator('input[type="radio"]');
    await expect(editRadios).toHaveCount(2);
    await expect(editRadios.nth(1), '„Fałsz” stays the correct answer').toBeChecked();
    await expect(editRadios.nth(0)).not.toBeChecked();
    await editDialog.getByRole('button', { name: COPY.cancel }).click();
    await expect(page.locator('[data-slot="dialog-content"]')).toHaveCount(0);

    // 4b. The type filter resolves the stored type: P/F keeps the row, open hides it.
    const typeFilter = page.getByRole('combobox');
    await expect(typeFilter).toContainText(COPY.allTypes);
    await chooseTypeFilter(page, COPY.trueFalse);
    await expect(questionRow(page), 'the P/F filter keeps the question').toHaveCount(1);

    await chooseTypeFilter(page, COPY.filterOpen);
    await expect(questionRow(page), 'an open-answer filter hides the P/F question').toHaveCount(0);
    await expect(page.getByText(COPY.noQuestions, { exact: true })).toBeVisible();

    await chooseTypeFilter(page, COPY.allTypes);
    await expect(questionRow(page)).toHaveCount(1);

    expect(failedDocuments, 'no navigation may answer with an error status').toEqual([]);
    expect(pageErrors, 'uncaught page errors during the walk').toEqual([]);
  });
});
