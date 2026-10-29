import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * STU-33 — edit and delete a question, then edit and delete its bank
 * (`/app/questions` and `/app/questions/<bankId>`).
 *
 * Case (verbatim → tenant model): its prerequisite is only „Własny bank z pytaniami”
 * (an own bank with questions). The legacy seed (`student1@dev.local`, password
 * `pass`) is never used; the walk runs as the student of the case's own tenant:
 *
 *   bun scripts/qa-tenant.ts STU-33 --fresh
 *
 * `__tests__/qa/profiles/STU-33.json` declares the `content` profile: one organization
 * `qa-stu-33-<suffix>` with its default group `G1`, a manager, an educator and the
 * `student` this case signs in as. Every id derives from
 * `tenantKey('qa/cases/STU-33.md', 'STU-33#<suffix>', 'qa-shared')` +
 * `tenantId(key, entity)`; nothing global is read or written (no admin setting,
 * feature flag, plan, platform stat, singleton row or other tenant).
 *
 * CI seeds the tenant once and reuses it for `--retry`/`--repeat-each`, so the spec
 * first deletes every bank this student owns through the product API — all of them
 * belong to this case, and deleting a bank cascades its questions and answers. The
 * walk then always starts from the case's empty state and creates its own bank with
 * two questions through the same API the product uses.
 *
 * Acceptance points confirmed on the shared app (:3010, Polish UI, worker qa-env-2):
 * 1. Editing a question (content + both answers) in the „Edytuj pytanie” dialog and
 *    saving answers the toast „Pytanie zaktualizowane”; the table row and the API
 *    show the new content and answers, and the old content is gone.
 * 2. Deleting the question opens the „Usunąć pytanie?” dialog with the description
 *    „To trwale usunie to pytanie i wszystkie jego odpowiedzi. Tej akcji nie można
 *    cofnąć.”; confirming answers „Pytanie usunięte”, removes the row and the API
 *    returns 404 for that question.
 * 3. The bank card's „…” menu edits the bank in the „Edytuj bank” dialog and answers
 *    „Bank pytań zaktualizowany”; deleting the bank opens „Usunąć bank pytań?” with
 *    „To trwale usunie ten bank i wszystkie jego pytania. Tej akcji nie można
 *    cofnąć.”, answers „Bank pytań usunięty”, and cascades: the bank AND the question
 *    still inside it are gone from the API, and the bank list is empty again.
 *
 * Adjacent regression on the same surface: the edited question keeps exactly two
 * answers with the same correct/incorrect flags, and the bank's own question count
 * still reports the two seeded questions before deletion — the toasts are backed by
 * real writes, not optimistic UI.
 */

const CASE = 'STU-33';

const BANKS_URL = '/api/v1/questions/banks';
const QUESTIONS_URL = '/api/v1/questions';

const BANK_NAME = 'STU-33 mój bank';
const BANK_EDITED = 'STU-33 mój bank (po edycji)';

/** Polish copy the case quotes, as the product renders it. */
const COPY = {
  manage: 'Zarządzaj',
  edit: 'Edytuj',
  delete: 'Usuń',
  update: 'Aktualizuj',
  editQuestionTitle: 'Edytuj pytanie',
  editQuestionDesc: 'Zaktualizuj szczegóły pytania',
  questionUpdated: 'Pytanie zaktualizowane',
  questionDeleted: 'Pytanie usunięte',
  deleteQuestionTitle: 'Usunąć pytanie?',
  deleteQuestionDesc:
    'To trwale usunie to pytanie i wszystkie jego odpowiedzi. Tej akcji nie można cofnąć.',
  editBankTitle: 'Edytuj bank',
  bankUpdated: 'Bank pytań zaktualizowany',
  bankDeleted: 'Bank pytań usunięty',
  deleteBankTitle: 'Usunąć bank pytań?',
  deleteBankDesc: 'To trwale usunie ten bank i wszystkie jego pytania. Tej akcji nie można cofnąć.',
} as const;

/** The run's two questions; the first is edited and deleted, the second proves the cascade. */
const SEED = {
  edited: {
    content: 'STU-33: Ile wynosi 2+2?',
    answers: [
      { text: '4', correct: true },
      { text: '5', correct: false },
    ],
    editedContent: 'STU-33: Ile wynosi 3+3?',
    editedAnswers: [
      { text: '6', correct: true },
      { text: '7', correct: false },
    ],
  },
  cascade: {
    content: 'STU-33: pytanie w usuwanym banku',
    answers: [
      { text: 'tak', correct: true },
      { text: 'nie', correct: false },
    ],
  },
} as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: string;
}

interface BankRow {
  id: string;
  name: string;
  created_by: string;
  organization_id: string | null;
  visibility: 'personal' | 'group';
  question_count: number;
}

interface QuestionRow {
  id: string;
  content: string;
  type: 'mcq' | 'true_false' | 'open';
  bank_id: string;
  created_by: string;
  question_answers?: { content: string; is_correct: boolean; order_index: number }[];
}

function studentOf(tenant: QaTenant): NonNullable<QaTenant['users']['student']> {
  const student = tenant.users.student;
  if (!student) throw new Error(`${CASE} needs the content tenant profile (student account)`);
  return student;
}

/** The newest sonner toast carrying this text. */
function toast(page: Page, text: string): Locator {
  return page.locator('[data-sonner-toast]').filter({ hasText: text }).last();
}

/** The bank's own card in the grid, addressed by its heading. */
function bankCard(page: Page, name: string): Locator {
  return page
    .locator('main [data-slot="card"]')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });
}

/** The card's „Więcej akcji: <name>” trigger (the mobile duplicate is `display:none`). */
function moreActions(page: Page, name: string): Locator {
  return bankCard(page, name).getByRole('button', { name: `Więcej akcji: ${name}` });
}

/** The dialog surface shared by the create/edit forms and the delete confirmations. */
function dialog(page: Page): Locator {
  return page.locator('[data-slot="dialog-content"]');
}

/** The dialog's primary action („Aktualizuj”, „Utwórz”, „Usuń”). */
function submitButton(page: Page): Locator {
  return dialog(page).locator('[data-slot="dialog-footer"] button:last-child');
}

/** The question's row in the table, matched by its exact content cell. */
function questionRow(page: Page, content: string): Locator {
  return page
    .locator('main table tbody tr')
    .filter({ has: page.locator('td', { hasText: content }) });
}

async function listBanks(page: Page): Promise<BankRow[]> {
  const response = await page.request.get(`${BANKS_URL}?limit=100`);
  expect(response.status(), `GET ${BANKS_URL} → ${response.status()}`).toBe(200);
  const body = (await response.json()) as ApiEnvelope<{ items: BankRow[] }>;
  expect(body.success, 'bank list success flag').toBe(true);
  return body.data.items;
}

async function listQuestions(page: Page, bankId: string): Promise<QuestionRow[]> {
  const response = await page.request.get(`${QUESTIONS_URL}?bankId=${bankId}`);
  expect(response.status(), `GET ${QUESTIONS_URL}?bankId=${bankId}`).toBe(200);
  const body = (await response.json()) as ApiEnvelope<QuestionRow[]>;
  expect(body.success, 'question list success flag').toBe(true);
  return body.data;
}

async function getQuestion(page: Page, id: string): Promise<QuestionRow> {
  const response = await page.request.get(`${QUESTIONS_URL}/${id}`);
  expect(
    response.status(),
    `GET ${QUESTIONS_URL}/${id} → ${response.status()} ${await response.text()}`,
  ).toBe(200);
  return ((await response.json()) as ApiEnvelope<QuestionRow>).data;
}

/**
 * A retry or a `--repeat-each` pass reuses the CI-seeded tenant: drop every bank
 * this student created (all belong to this case; their questions cascade) so the
 * walk always starts from the empty `/app/questions` list.
 */
async function resetRunState(page: Page, tenant: QaTenant): Promise<void> {
  const student = studentOf(tenant);
  for (const bank of (await listBanks(page)).filter((item) => item.created_by === student.id)) {
    const deleted = await page.request.delete(`${BANKS_URL}/${bank.id}`);
    expect(deleted.status(), `DELETE ${BANKS_URL}/${bank.id} (${bank.name})`).toBe(200);
  }
}

/** The case's prerequisite: the student's own bank, created through the product API. */
async function createBank(page: Page, tenant: QaTenant): Promise<BankRow> {
  const student = studentOf(tenant);
  const response = await page.request.post(BANKS_URL, { data: { name: BANK_NAME } });
  expect(
    response.status(),
    `POST ${BANKS_URL} (${BANK_NAME}) → ${response.status()} ${await response.text()}`,
  ).toBe(201);
  const bank = ((await response.json()) as ApiEnvelope<BankRow>).data;
  expect(bank.created_by, 'the bank belongs to the signed-in student').toBe(student.id);
  expect(bank.organization_id, 'the bank lives in the tenant organization').toBe(tenant.org?.id);
  expect(bank.visibility, 'a student bank is personal').toBe('personal');
  return bank;
}

async function createQuestion(
  page: Page,
  bankId: string,
  seed: { content: string; answers: readonly { text: string; correct: boolean }[] },
): Promise<QuestionRow> {
  const response = await page.request.post(QUESTIONS_URL, {
    data: {
      bankId,
      type: 'mcq',
      content: seed.content,
      answers: seed.answers.map((answer, index) => ({
        content: answer.text,
        isCorrect: answer.correct,
        orderIndex: index,
      })),
    },
  });
  expect(
    response.status(),
    `POST ${QUESTIONS_URL} (${seed.content}) → ${response.status()} ${await response.text()}`,
  ).toBe(201);
  return ((await response.json()) as ApiEnvelope<QuestionRow>).data;
}

function answersOf(question: QuestionRow) {
  return [...(question.question_answers ?? [])]
    .sort((left, right) => (left.order_index ?? 0) - (right.order_index ?? 0))
    .map((answer) => ({ text: answer.content, correct: answer.is_correct }));
}

test.describe('@case:STU-33 @area:STU @prio:P2 edit and delete a question and its bank', () => {
  test('edits and deletes a question, then edits and deletes the bank with its questions', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    expect(tenant.key, `${CASE} tenant key`).toContain(`${CASE}.md::${CASE}`);
    const student = studentOf(tenant);
    expect(tenant.org, 'the student belongs to the tenant organization').toBeTruthy();

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

    // --- Prerequisite: the student's own bank with two questions ------------
    await resetRunState(page, tenant);
    const bank = await createBank(page, tenant);
    const edited = await createQuestion(page, bank.id, SEED.edited);
    const cascade = await createQuestion(page, bank.id, SEED.cascade);

    console.log(`${CASE} tenant key: ${tenant.key}`);
    console.log(`${CASE} org: ${tenant.org?.id} (${tenant.org?.name})`);
    console.log(`${CASE} bank: ${bank.id} ${bank.name}`);
    console.log(`${CASE} questions: ${edited.id}, ${cascade.id}`);

    // --- Entry from the bank list: the card opens the bank detail -----------
    await page.goto('/app/questions');
    await expect(page).toHaveURL(/\/app\/questions$/);
    const card = bankCard(page, BANK_NAME);
    await expect(card, 'the seeded bank is in the student list').toBeVisible();
    await expect(card).toContainText('2 pytania');
    await card.getByRole('button', { name: COPY.manage, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/app/questions/${bank.id}$`));
    await expect(page.getByRole('heading', { name: BANK_NAME, exact: true })).toBeVisible();

    // --- Step 1: edit the question (content + answers) and save ------------
    const row = questionRow(page, SEED.edited.content);
    await expect(row, 'the question to edit is in the table').toBeVisible();
    await expect(row.locator('td').nth(3), 'it starts with two answers').toHaveText('2');
    await row.getByRole('button', { name: COPY.edit, exact: true }).click();

    const editForm = dialog(page);
    await expect(editForm.getByRole('heading', { name: COPY.editQuestionTitle })).toBeVisible();
    await expect(editForm.getByText(COPY.editQuestionDesc, { exact: true })).toBeVisible();

    const contentInput = editForm.locator('textarea[placeholder="Wpisz swoje pytanie..."]');
    await expect(contentInput, 'the form starts from the stored content').toHaveValue(
      SEED.edited.content,
    );
    await expect(editForm.locator('input[placeholder="Odpowiedź 1"]')).toHaveValue(
      SEED.edited.answers[0].text,
    );
    await expect(editForm.locator('input[placeholder="Odpowiedź 2"]')).toHaveValue(
      SEED.edited.answers[1].text,
    );
    await expect(
      editForm.locator('input[type="radio"]').first(),
      'the correct answer stays selected',
    ).toBeChecked();

    await contentInput.fill(SEED.edited.editedContent);
    await editForm
      .locator('input[placeholder="Odpowiedź 1"]')
      .fill(SEED.edited.editedAnswers[0].text);
    await editForm
      .locator('input[placeholder="Odpowiedź 2"]')
      .fill(SEED.edited.editedAnswers[1].text);

    await submitButton(page).click();
    await expect(
      toast(page, COPY.questionUpdated),
      'the „Pytanie zaktualizowane” toast',
    ).toBeVisible();
    await expect(dialog(page), 'the edit dialog closes').toHaveCount(0);

    const editedRow = questionRow(page, SEED.edited.editedContent);
    await expect(editedRow, 'the table shows the new content').toBeVisible();
    await expect(editedRow.locator('td').nth(3), 'the two answers are kept').toHaveText('2');
    await expect(questionRow(page, SEED.edited.content), 'the old content is gone').toHaveCount(0);

    const stored = await getQuestion(page, edited.id);
    expect(stored.content, 'the API stores the edited content').toBe(SEED.edited.editedContent);
    expect(answersOf(stored), 'the API stores the edited answers').toEqual(
      SEED.edited.editedAnswers.map((answer) => ({ text: answer.text, correct: answer.correct })),
    );

    // --- Step 2: delete the question ---------------------------------------
    await editedRow.getByRole('button', { name: COPY.delete, exact: true }).click();
    const questionDelete = dialog(page);
    await expect(
      questionDelete.getByRole('heading', { name: COPY.deleteQuestionTitle }),
    ).toBeVisible();
    await expect(questionDelete.getByText(COPY.deleteQuestionDesc, { exact: true })).toBeVisible();

    await questionDelete.getByRole('button', { name: COPY.delete, exact: true }).click();
    await expect(toast(page, COPY.questionDeleted), 'the „Pytanie usunięte” toast').toBeVisible();
    await expect(dialog(page), 'the confirmation closes').toHaveCount(0);
    await expect(
      questionRow(page, SEED.edited.editedContent),
      'the row leaves the table',
    ).toHaveCount(0);

    const removedQuestion = await page.request.get(`${QUESTIONS_URL}/${edited.id}`);
    expect(removedQuestion.status(), `GET the deleted question → ${removedQuestion.status()}`).toBe(
      404,
    );
    expect(
      (await listQuestions(page, bank.id)).map((question) => question.id),
      'only the cascade question remains in the bank',
    ).toEqual([cascade.id]);

    // --- Step 3a: edit the bank from its card menu -------------------------
    await page.goto('/app/questions');
    await expect(bankCard(page, BANK_NAME), 'the bank is still listed').toBeVisible();
    await moreActions(page, BANK_NAME).click();
    await page.getByRole('menuitem', { name: COPY.edit, exact: true }).click();

    const bankForm = dialog(page);
    await expect(bankForm.getByRole('heading', { name: COPY.editBankTitle })).toBeVisible();
    const bankName = bankForm.locator('#bank-name');
    await expect(bankName, 'the form starts from the current name').toHaveValue(BANK_NAME);
    await bankName.fill(BANK_EDITED);

    await submitButton(page).click();
    await expect(
      toast(page, COPY.bankUpdated),
      'the „Bank pytań zaktualizowany” toast',
    ).toBeVisible();
    await expect(dialog(page), 'the bank dialog closes').toHaveCount(0);
    await expect(bankCard(page, BANK_EDITED), 'the card carries the new name').toBeVisible();
    await expect(bankCard(page, BANK_NAME), 'the old name is gone').toHaveCount(0);

    const renamedResponse = await page.request.get(`${BANKS_URL}/${bank.id}`);
    expect(renamedResponse.status(), 'GET the edited bank').toBe(200);
    const renamedBank = ((await renamedResponse.json()) as ApiEnvelope<BankRow>).data;
    expect(renamedBank.name).toBe(BANK_EDITED);
    expect(renamedBank.question_count, 'the rename keeps the bank’s question').toBe(1);

    // --- Step 3b: delete the bank; its question cascades -------------------
    expect(
      (await getQuestion(page, cascade.id)).content,
      'the cascade question still exists before the bank delete',
    ).toBe(SEED.cascade.content);

    await moreActions(page, BANK_EDITED).click();
    await page.getByRole('menuitem', { name: COPY.delete, exact: true }).click();
    const bankDelete = dialog(page);
    await expect(bankDelete.getByRole('heading', { name: COPY.deleteBankTitle })).toBeVisible();
    await expect(bankDelete.getByText(COPY.deleteBankDesc, { exact: true })).toBeVisible();

    await bankDelete.getByRole('button', { name: COPY.delete, exact: true }).click();
    await expect(toast(page, COPY.bankDeleted), 'the „Bank pytań usunięty” toast').toBeVisible();
    await expect(dialog(page), 'the confirmation closes').toHaveCount(0);
    await expect(bankCard(page, BANK_EDITED), 'the deleted bank leaves the list').toHaveCount(0);

    const removedBank = await page.request.get(`${BANKS_URL}/${bank.id}`);
    expect(removedBank.status(), 'GET the deleted bank → 404').toBe(404);
    const cascaded = await page.request.get(`${QUESTIONS_URL}/${cascade.id}`);
    expect(
      cascaded.status(),
      `GET the question inside the deleted bank → ${cascaded.status()}`,
    ).toBe(404);
    expect(
      (await listQuestions(page, bank.id)).length,
      'the deleted bank has no questions left',
    ).toBe(0);
    expect(
      (await listBanks(page)).filter((item) => item.created_by === student.id),
      'the student owns no bank after the delete',
    ).toHaveLength(0);

    expect(pageErrors, 'the question-bank walk raises no uncaught errors').toEqual([]);
  });
});
