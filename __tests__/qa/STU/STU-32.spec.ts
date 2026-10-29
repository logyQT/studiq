import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * STU-32 — the student's own question bank and own questions (/app/questions).
 *
 * Case: „Nowy bank” → „Mój bank” → save; open the bank → „Utwórz pytanie”; create
 * one question of each type — Wielokrotny wybór (3 answers, one marked correct),
 * Prawda/Fałsz and Otwarta odpowiedź with an explanation. Expected: the toasts
 * „Bank pytań utworzony” and „Pytanie utworzone”, and the question table shows the
 * content, the type, the topics and the answer count, with the P/F options
 * „Prawda”/„Fałsz” generated for the true/false question.
 *
 * Tenant (deterministic, `content` profile, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts STU-32 --fresh
 *
 * gives the org `qa-stu-32-<suffix>` with a manager, an educator and the student this
 * case signs in as — every id derived from `tenantKey('qa/cases/STU-32.md',
 * 'STU-32#<suffix>', 'qa-shared')`. The case's prerequisite („Zalogowany student1”,
 * the legacy `student1@dev.local` with `pass`) maps onto that student. Nothing global
 * is read or written — no admin setting, feature flag, plan, platform stat or
 * singleton row — and no other tenant is touched.
 *
 * CI seeds the tenant once and reuses it for retries and `--repeat-each` passes, so
 * the test first deletes the student's own banks (all of them are this case's, and
 * deleting a bank cascades its questions and answers) through the product API. Every
 * run then starts from the case's empty state.
 *
 * The walk on the shared app (:3010, Polish UI, worker qa-env-4) confirmed:
 * - The student's bank list offers „Nowy bank” (toolbar and empty state). The form is
 *   „Nowy bank” with `Nazwa` / `Opis`; a student gets no visibility selector (their
 *   banks are personal). „Utwórz” answers the toast „Bank pytań utworzony” and the
 *   card shows „Mój bank”, „0 pytań” and „Zarządzaj”.
 * - „Zarządzaj” opens `/app/questions/<bankId>`; the bank detail offers „Utwórz
 *   pytanie” and the table headers Pytanie / Typ / Tematy / Odpowiedzi / Akcje.
 * - The create dialog offers „Wielokrotny wybór”, „Prawda / Fałsz”, „Otwarta
 *   odpowiedź”; saving answers „Pytanie utworzone”.
 * - The P/F switch seeds the two editable options „Prawda” / „Fałsz” immediately
 *   (product decision #154/#607; there is no „Generuj opcje Prawda/Fałsz” button any
 *   more — the case text predates it). „Prawda” is pre-selected as the correct answer.
 * - The type column renders the full labels: „Wielokrotnego wyboru”, „Prawda / Fałsz”,
 *   „Otwarte” (the case's „WW / P/F / Otwarte” abbreviations are outdated copy).
 * - API: `POST /api/v1/questions/banks` → 201, `POST /api/v1/questions` → 201;
 *   `GET /api/v1/questions?bankId=<id>` returns the three questions with their
 *   answers/explanation, and the bank's `question_count` becomes 3.
 */

const CASE = 'STU-32';

const BANKS_URL = '/api/v1/questions/banks';
const QUESTIONS_URL = '/api/v1/questions';

const BANK_NAME = 'Mój bank';

/** Polish copy the case quotes, as the product renders it. */
const COPY = {
  newBank: 'Nowy bank',
  createBank: 'Utwórz',
  bankCreated: 'Bank pytań utworzony',
  manage: 'Zarządzaj',
  createQuestion: 'Utwórz pytanie',
  questionCreated: 'Pytanie utworzone',
  description: 'Dodaj nowe pytanie do tego banku',
  typeMcq: 'Wielokrotny wybór',
  typeTf: 'Prawda / Fałsz',
  typeOpen: 'Otwarta odpowiedź',
  badgeMcq: 'Wielokrotnego wyboru',
  badgeTf: 'Prawda / Fałsz',
  badgeOpen: 'Otwarte',
  addAnswer: 'Dodaj odpowiedź',
  trueLabel: 'Prawda',
  falseLabel: 'Fałsz',
} as const;

/** The run's questions. Content is fixed (the bank is cleaned before the walk), so a
 * retry never sees a second copy. */
const QUESTIONS = {
  mcq: {
    content: 'Która planeta jest największa?',
    answers: [
      { text: 'Jowisz', correct: true },
      { text: 'Mars', correct: false },
      { text: 'Wenus', correct: false },
    ],
  },
  tf: {
    content: 'Ziemia jest trzecią planetą od Słońca.',
  },
  open: {
    content: 'Opisz cykl wodny.',
    explanation: 'Parowanie, kondensacja, opad i spływ.',
  },
} as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface BankRow {
  id: string;
  name: string;
  created_by: string;
  visibility: 'personal' | 'group';
  question_count: number;
}

interface QuestionRow {
  id: string;
  content: string;
  type: 'mcq' | 'true_false' | 'open';
  explanation: string | null;
  topics?: { id: string; name: string }[];
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

/** The question dialog (only one dialog is open at a time on this screen). */
function dialog(page: Page): Locator {
  return page.locator('[data-slot="dialog-content"]');
}

function submitButton(page: Page): Locator {
  return dialog(page).locator('[data-slot="dialog-footer"] button:last-child');
}

/** The question's row in the table, matched by its exact content cell. */
function questionRow(page: Page, content: string): Locator {
  return page
    .locator('main table tbody tr')
    .filter({ has: page.locator('td', { hasText: content }) });
}

/** All banks the student can read — the same list the screen renders. */
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

/**
 * A retry or a `--repeat-each` pass reuses the CI-seeded tenant: drop the banks this
 * student created (all of them belong to this case; their questions cascade), so the
 * walk always starts from the empty `/app/questions` list.
 */
async function resetRunState(page: Page, tenant: QaTenant): Promise<void> {
  const student = studentOf(tenant);
  for (const bank of (await listBanks(page)).filter((item) => item.created_by === student.id)) {
    const deleted = await page.request.delete(`${BANKS_URL}/${bank.id}`);
    expect(deleted.status(), `DELETE ${BANKS_URL}/${bank.id} (${bank.name})`).toBe(200);
  }
}

/** Open the „Utwórz pytanie” dialog on the bank detail page. */
async function openQuestionDialog(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: COPY.createQuestion, exact: true }).click();
  const form = dialog(page);
  await expect(form).toBeVisible();
  await expect(form.getByRole('heading', { name: COPY.createQuestion })).toBeVisible();
  await expect(form.getByText(COPY.description, { exact: true })).toBeVisible();
  return form;
}

/** Pick the question type in the create dialog's Radix select. */
async function selectType(page: Page, label: string): Promise<void> {
  await dialog(page).locator('[data-slot="select-trigger"]').click();
  const option = page.getByRole('option', { name: label, exact: true });
  await expect(option).toBeVisible();
  await option.click();
  await expect(dialog(page).locator('[data-slot="select-trigger"]')).toContainText(label);
}

/** Fill the question's content and submit the dialog. */
async function saveQuestion(page: Page, content: string, explanation?: string): Promise<void> {
  const form = dialog(page);
  await form.locator('textarea[placeholder="Wpisz swoje pytanie..."]').fill(content);
  if (explanation) {
    await form
      .locator('textarea[placeholder="Wyjaśnij, dlaczego odpowiedź jest poprawna..."]')
      .fill(explanation);
  }
  await submitButton(page).click();
  await expect(toast(page, COPY.questionCreated), 'the „Pytanie utworzone” toast').toBeVisible();
  await expect(dialog(page), 'the question dialog closes').toHaveCount(0);
}

test.describe('@case:STU-32 @area:STU @prio:P2 own question bank and questions', () => {
  test('creates „Mój bank” and one WW, P/F and open question in it', async ({ page }) => {
    test.setTimeout(150_000);

    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    const student = studentOf(tenant);
    expect(tenant.org, 'the student belongs to the tenant organization').toBeTruthy();

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

    // --- Prerequisite: this student's own, empty bank list -------------------
    await resetRunState(page, tenant);
    await page.goto('/app/questions');
    await expect(page).toHaveURL(/\/app\/questions$/);
    await expect(bankCard(page, BANK_NAME), 'a previous attempt left no bank behind').toHaveCount(
      0,
    );

    // --- Step 1: „Nowy bank” → „Mój bank” → save ----------------------------
    await page.getByRole('button', { name: COPY.newBank, exact: true }).first().click();
    const bankDialog = dialog(page);
    await expect(bankDialog.getByRole('heading', { name: COPY.newBank })).toBeVisible();
    await bankDialog.locator('#bank-name').fill(BANK_NAME);

    await submitButton(page).click();

    await expect(toast(page, COPY.bankCreated), 'the „Bank pytań utworzony” toast').toBeVisible();
    await expect(dialog(page), 'the bank dialog closes').toHaveCount(0);

    const createdCard = bankCard(page, BANK_NAME);
    await expect(createdCard, 'the new bank card is in the grid').toBeVisible();
    await expect(createdCard).toContainText('0 pytań');
    await expect(createdCard.getByRole('button', { name: COPY.manage })).toBeVisible();

    const banks = await listBanks(page);
    const createdBanks = banks.filter((bank) => bank.name === BANK_NAME);
    expect(createdBanks, 'exactly one „Mój bank” exists').toHaveLength(1);
    const bank = createdBanks[0];
    expect(bank.created_by, 'the bank belongs to the signed-in student').toBe(student.id);
    expect(bank.visibility, 'a student bank is personal').toBe('personal');
    expect(bank.question_count, 'the fresh bank is empty').toBe(0);

    // --- Step 2: enter the bank → „Utwórz pytanie” --------------------------
    await createdCard.getByRole('button', { name: COPY.manage }).click();
    await expect(page).toHaveURL(new RegExp(`/app/questions/${bank.id}$`));
    await expect(page.getByRole('heading', { name: BANK_NAME, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: COPY.createQuestion })).toBeVisible();

    // The table the case checks: content, type, topics, answer count.
    const header = page.locator('main table thead');
    for (const label of ['Pytanie', 'Typ', 'Tematy', 'Odpowiedzi', 'Akcje']) {
      await expect(
        header.getByRole('columnheader', { name: new RegExp(`^${label}`) }),
      ).toBeVisible();
    }

    // --- Step 3a: Wielokrotny wybór — 3 answers, one marked correct --------
    let form = await openQuestionDialog(page);
    await selectType(page, COPY.typeMcq);
    await form
      .locator('textarea[placeholder="Wpisz swoje pytanie..."]')
      .fill(QUESTIONS.mcq.content);
    await form.locator('input[placeholder="Odpowiedź 1"]').fill(QUESTIONS.mcq.answers[0].text);

    for (let index = 1; index < QUESTIONS.mcq.answers.length; index += 1) {
      await form.getByRole('button', { name: COPY.addAnswer }).click();
      await form
        .locator(`input[placeholder="Odpowiedź ${index + 1}"]`)
        .fill(QUESTIONS.mcq.answers[index].text);
    }

    // Exactly one correct answer: the first radio.
    await form.locator('input[type="radio"]').first().check();
    await expect(form.locator('input[type="radio"]').first()).toBeChecked();

    await submitButton(page).click();
    await expect(toast(page, COPY.questionCreated)).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);

    const mcqRow = questionRow(page, QUESTIONS.mcq.content);
    await expect(mcqRow, 'the WW question is in the table').toBeVisible();
    await expect(mcqRow).toContainText(COPY.badgeMcq);
    await expect(mcqRow.locator('td').nth(3)).toHaveText(String(QUESTIONS.mcq.answers.length));

    // --- Step 3b: Prawda/Fałsz — options „Prawda” / „Fałsz” ----------------
    form = await openQuestionDialog(page);
    await selectType(page, COPY.typeTf);

    const tfAnswers = form.locator('input[placeholder^="Odpowiedź"]');
    await expect(tfAnswers, 'the P/F options are generated').toHaveCount(2);
    await expect(tfAnswers.nth(0), 'the first option').toHaveValue(COPY.trueLabel);
    await expect(tfAnswers.nth(1), 'the second option').toHaveValue(COPY.falseLabel);
    await expect(form.locator('input[type="radio"]').first(), '„Prawda” is correct').toBeChecked();

    await saveQuestion(page, QUESTIONS.tf.content);

    const tfRow = questionRow(page, QUESTIONS.tf.content);
    await expect(tfRow, 'the P/F question is in the table').toBeVisible();
    await expect(tfRow).toContainText(COPY.badgeTf);
    await expect(tfRow.locator('td').nth(3)).toHaveText('2');

    // --- Step 3c: Otwarta odpowiedź with an explanation --------------------
    form = await openQuestionDialog(page);
    await selectType(page, COPY.typeOpen);
    // An open question has no answer inputs at all.
    await expect(form.locator('input[placeholder^="Odpowiedź"]'), 'no answer rows').toHaveCount(0);

    await saveQuestion(page, QUESTIONS.open.content, QUESTIONS.open.explanation);

    const openRow = questionRow(page, QUESTIONS.open.content);
    await expect(openRow, 'the open question is in the table').toBeVisible();
    await expect(openRow).toContainText(COPY.badgeOpen);
    await expect(openRow.locator('td').nth(3), 'an open question has 0 answers').toHaveText('0');

    // --- Expected result, server side --------------------------------------
    const questions = await listQuestions(page, bank.id);
    expect(questions, 'the bank holds exactly the three created questions').toHaveLength(3);

    const mcq = questions.find((question) => question.content === QUESTIONS.mcq.content);
    expect(mcq?.type, 'WW type').toBe('mcq');
    expect(mcq?.question_answers, 'WW answers').toHaveLength(3);
    expect(
      mcq?.question_answers?.map((answer) => ({
        text: answer.content,
        correct: answer.is_correct,
      })),
      'WW answer text and the single correct option',
    ).toEqual(
      QUESTIONS.mcq.answers.map((answer) => ({ text: answer.text, correct: answer.correct })),
    );

    const tf = questions.find((question) => question.content === QUESTIONS.tf.content);
    expect(tf?.type, 'P/F type').toBe('true_false');
    expect(
      tf?.question_answers?.map((answer) => ({ text: answer.content, correct: answer.is_correct })),
      'P/F options „Prawda” / „Fałsz”',
    ).toEqual([
      { text: COPY.trueLabel, correct: true },
      { text: COPY.falseLabel, correct: false },
    ]);

    const open = questions.find((question) => question.content === QUESTIONS.open.content);
    expect(open?.type, 'open type').toBe('open');
    expect(open?.explanation, 'the open question keeps its explanation').toBe(
      QUESTIONS.open.explanation,
    );
    expect(open?.question_answers ?? [], 'an open question stores no answers').toHaveLength(0);

    // The bank list reflects the three questions after a reload.
    await page.goto('/app/questions');
    const finalCard = bankCard(page, BANK_NAME);
    await expect(finalCard).toBeVisible();
    await expect(finalCard).toContainText('3 pytania');

    expect(pageErrors, 'the question-bank walk raises no uncaught errors').toEqual([]);
  });
});
