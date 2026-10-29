import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * EDU-Q-04 — pytanie otwarte („Otwarta odpowiedź”) w banku „Fizyka”.
 *
 * Case steps: create an „Otwarta odpowiedź” question with a model-answer
 * explanation in the bank „Fizyka”.
 * Acceptance:
 * 1. the form has no answer list for that type and the question is stored as
 *    type „Otwarte” (`open`) with no answer rows;
 * 2. during a quiz the student types free text, and the teacher grades that text
 *    manually (the case defers the grading detail to EDU-ASG-…).
 *
 * Tenant (`content` profile, deterministic ids, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts EDU-Q-04 --fresh
 *
 * gives the org `qa-edu-q-04-<suffix>` with a manager, an educator and a student,
 * plus the default group `G1` (`tenantKey('qa/cases/EDU-Q-04.md',
 * 'EDU-Q-04#<suffix>', 'qa-shared')` + `tenantId` for every id). The spec reads
 * the ids through `loadTenant('EDU-Q-04')`; nothing global is read or written.
 *
 * The case was written against the legacy manual seed (`teacher1@dev.local`,
 * password `pass`, bank „Fizyka” from the manual dataset). The suite builds its own
 * prerequisite inside its own tenant: the bank „Fizyka” (product API, reused when it
 * already exists), the open question (the case's own step, through the UI), and a
 * published assignment with that question targeted at the tenant student (product
 * API). Both the assignment and any earlier copy of the question are removed first,
 * so every execution — including a CI retry against the same seeded tenant
 * (`--retries=2`) — starts from the same state instead of depending on an earlier
 * run's leftovers.
 *
 * Acceptance points confirmed on the shared app during the walk (2026-10-29):
 * 1. „Utwórz pytanie” opens the question dialog in „Wielokrotny wybór” mode with the
 *    „Odpowiedzi” block (a „Dodaj odpowiedź” button and the correct-answer hint).
 * 2. Choosing „Otwarta odpowiedź” removes that block entirely — no answer inputs, no
 *    radio buttons — while the explanation textarea stays.
 * 3. Saving answers „Pytanie utworzone”; the bank table shows one row with the type
 *    badge „Otwarte”, „—” topics and „0” answers, and the API returns
 *    `type: 'open'`, the stored explanation and `question_answers: []`.
 * 4. In the quiz the same question renders as a free-text field
 *    („Wpisz swoją odpowiedź…”) instead of answer options; the submitted text is
 *    stored as `text_answer`.
 * 5. „Oceń ucznia” shows the model answer („Wyjaśnienie: …”) and the student's text
 *    („Odpowiedź ucznia: …”) with a points input; saving „1” turns the header into
 *    „Wynik: 1/1 (ocenione)” and stores `teacher_points: 1`.
 */

const CASE = 'EDU-Q-04';

/** Polish copy from `QuestionForm`, `QuestionBankDetail`, `AppQuizTakingPage`, `EduGradingPage`. */
const COPY = {
  bankName: 'Fizyka',
  bankCreated: 'Bank pytań utworzony',
  createQuestion: 'Utwórz pytanie',
  createDialogTitle: 'Utwórz pytanie',
  typeLabel: 'Typ pytania',
  typeMultipleChoice: 'Wielokrotny wybór',
  typeOpen: 'Otwarta odpowiedź',
  answersLabel: 'Odpowiedzi',
  addAnswer: 'Dodaj odpowiedź',
  explanationLabel: 'Wyjaśnienie (opcjonalnie)',
  created: 'Pytanie utworzone',
  openBadge: 'Otwarte',
  startQuiz: 'Rozpocznij kartkówkę',
  submitQuiz: 'Wyślij',
  completed: 'Ukończono',
  gradingTitle: 'Oceń ucznia',
  saveGrade: 'Zapisz ocenę',
} as const;

const QUESTION_CONTENT = 'Opisz drugą zasadę dynamiki Newtona i podaj przykład.';
const EXPLANATION =
  'F = m·a. Przykład: wózek o masie 2 kg pod działaniem siły 4 N uzyskuje przyspieszenie 2 m/s².';
const STUDENT_ANSWER =
  'Przyspieszenie ciała jest wprost proporcjonalne do wypadkowej siły i odwrotnie proporcjonalne do masy.';
const ASSIGNMENT_TITLE = 'EDU-Q-04 kartkówka otwarta';

const BANKS_URL = '/api/v1/questions/banks';
const QUESTIONS_URL = '/api/v1/questions';
const TEACHER_ASSIGNMENTS_URL = '/api/v1/teacher/assignments';

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface BankListResult {
  items: Array<{ id: string; name: string }>;
}

interface Question {
  id: string;
  bank_id: string;
  type: 'mcq' | 'true_false' | 'open';
  content: string;
  explanation: string | null;
  question_answers: Array<{ id: string; content: string }>;
}

interface AssignmentSummary {
  id: string;
  title: string;
  status: 'draft' | 'published';
}

interface AssignmentDetail extends AssignmentSummary {
  assignment_questions: Array<{ question_id: string }>;
}

interface StudentAnswers {
  score: number;
  total_points: number | null;
  graded_at: string | null;
  quiz_answers: Array<{
    question_id: string;
    text_answer: string | null;
    selected_option_id: string | null;
    teacher_points: number | null;
    teacher_feedback: string | null;
  }>;
}

/** Send one product-API request and unwrap the `{ success, data }` envelope. */
async function api<T>(
  request: APIRequestContext,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  data?: unknown,
): Promise<T> {
  const response = await request.fetch(url, { method, data });
  const body = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok() || !body.success) {
    throw new Error(`${method} ${url} → ${response.status()} ${JSON.stringify(body)}`);
  }
  return body.data;
}

/** The case's bank „Fizyka”; reused when an earlier execution created it. */
async function ensureBank(page: Page): Promise<string> {
  const banks = await api<BankListResult>(page.request, 'GET', `${BANKS_URL}?limit=100`);
  const existing = banks.items.find((bank) => bank.name === COPY.bankName);
  if (existing) return existing.id;

  const created = await api<{ id: string }>(page.request, 'POST', BANKS_URL, {
    name: COPY.bankName,
    description: 'Bank z pytaniem otwartym (EDU-Q-04)',
  });
  return created.id;
}

/**
 * Start every execution from the same state: drop the case's assignment (cascades
 * its attempts) and any earlier copy of the open question, so the UI step always
 * creates the question under test and the student always has a fresh attempt.
 */
async function resetCaseContent(page: Page, bankId: string): Promise<void> {
  const assignments = await api<AssignmentSummary[]>(page.request, 'GET', TEACHER_ASSIGNMENTS_URL);
  for (const assignment of assignments.filter((row) => row.title === ASSIGNMENT_TITLE)) {
    await api(page.request, 'DELETE', `${TEACHER_ASSIGNMENTS_URL}/${assignment.id}`);
  }

  const questions = await api<Question[]>(page.request, 'GET', `${QUESTIONS_URL}?bankId=${bankId}`);
  for (const question of questions.filter((row) => row.content === QUESTION_CONTENT)) {
    await api(page.request, 'DELETE', `${QUESTIONS_URL}/${question.id}`);
  }
}

/** The product-API question list for this bank. */
async function listQuestions(page: Page, bankId: string): Promise<Question[]> {
  return api<Question[]>(page.request, 'GET', `${QUESTIONS_URL}?bankId=${bankId}`);
}

async function createPublishedAssignment(page: Page, questionId: string, studentId: string) {
  const assignment = await api<AssignmentSummary>(page.request, 'POST', TEACHER_ASSIGNMENTS_URL, {
    title: ASSIGNMENT_TITLE,
  });

  await api(page.request, 'POST', `${TEACHER_ASSIGNMENTS_URL}/${assignment.id}/questions`, {
    questionIds: [questionId],
  });
  await api(page.request, 'PUT', `${TEACHER_ASSIGNMENTS_URL}/${assignment.id}/targets`, {
    studentIds: [studentId],
  });
  await api(page.request, 'POST', `${TEACHER_ASSIGNMENTS_URL}/${assignment.id}/publish`, {});

  const detail = await api<AssignmentDetail>(
    page.request,
    'GET',
    `${TEACHER_ASSIGNMENTS_URL}/${assignment.id}`,
  );
  expect(detail.status, 'the quiz with the open question is published').toBe('published');
  expect(
    detail.assignment_questions.map((row) => row.question_id),
    'the quiz contains exactly the open question',
  ).toEqual([questionId]);

  return assignment.id;
}

function questionRow(page: Page, content: string): Locator {
  return page.locator('tbody tr').filter({ hasText: content });
}

test.describe('@case:EDU-Q-04 @area:EDU @prio:P2 open answer question', () => {
  test('creates an „Otwarta odpowiedź” question without answers and grades it manually', async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(150_000);
    const tenant: QaTenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    const student = tenant.users.student;
    if (!student) {
      throw new Error(`${CASE} needs the content tenant profile (org, group and student)`);
    }

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu(\/|$)/ });
    expect(page.locator('html')).toHaveAttribute('lang', 'pl');

    // ── Prerequisite: the bank „Fizyka”, in a state this execution owns ──────
    const bankId = await ensureBank(page);
    await resetCaseContent(page, bankId);

    await page.goto(`/edu/questions/${bankId}`);
    await expect(page.getByRole('heading', { name: COPY.bankName, exact: true })).toBeVisible();
    await expect(
      page.getByText('Brak pytań w tym banku. Utwórz swoje pierwsze pytanie!', { exact: true }),
    ).toBeVisible();

    // ── Step 1: create an „Otwarta odpowiedź” question with an explanation ──
    await page.getByRole('button', { name: COPY.createQuestion }).click();
    const dialog = page.locator('[data-slot="dialog-content"]');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: COPY.createDialogTitle })).toBeVisible();

    // Baseline: the default type is a choice question, so the answer block exists.
    await expect(dialog.locator('[data-slot="select-trigger"]')).toContainText(
      COPY.typeMultipleChoice,
    );
    await expect(dialog.getByText(COPY.answersLabel, { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: COPY.addAnswer })).toBeVisible();

    // „Otwarta odpowiedź” → the answer list disappears; only the free-text
    // question and the explanation remain.
    await dialog.locator('[data-slot="select-trigger"]').click();
    await page.getByRole('option', { name: COPY.typeOpen, exact: true }).click();
    await expect(dialog.locator('[data-slot="select-trigger"]')).toContainText(COPY.typeOpen);

    await expect(
      dialog.getByText(COPY.answersLabel, { exact: true }),
      'an open question has no answer list',
    ).toHaveCount(0);
    await expect(
      dialog.getByRole('button', { name: COPY.addAnswer }),
      'an open question has no „Dodaj odpowiedź” action',
    ).toHaveCount(0);
    await expect(
      dialog.locator('input[type="radio"]'),
      'an open question has no correct-answer radio',
    ).toHaveCount(0);
    await expect(dialog.getByText(COPY.explanationLabel, { exact: true })).toBeVisible();

    await dialog.locator('textarea[placeholder="Wpisz swoje pytanie..."]').fill(QUESTION_CONTENT);
    await dialog
      .locator('textarea[placeholder="Wyjaśnij, dlaczego odpowiedź jest poprawna..."]')
      .fill(EXPLANATION);
    await dialog.getByRole('button', { name: 'Utwórz', exact: true }).click();

    // ── Expected: saved as „Otwarte”, with no answers ───────────────────────
    await expect(page.getByText(COPY.created, { exact: true }).first()).toBeVisible();
    await expect(page.locator('[data-slot="dialog-content"]')).toHaveCount(0);

    const row = questionRow(page, QUESTION_CONTENT);
    await expect(row, 'the new question is the bank’s only row').toHaveCount(1);
    const cells = row.locator('td');
    await expect(cells.nth(0)).toHaveText(QUESTION_CONTENT);
    await expect(cells.nth(1), 'the type badge reads „Otwarte”').toHaveText(COPY.openBadge);
    await expect(cells.nth(3), 'an open question stores zero answers').toHaveText('0');

    const questions = await listQuestions(page, bankId);
    const created = questions.find((question) => question.content === QUESTION_CONTENT);
    expect(created, 'the question is readable through the product API').toBeDefined();
    expect(created!.type, 'stored question type').toBe('open');
    expect(created!.explanation, 'the model-answer explanation is stored').toBe(EXPLANATION);
    expect(created!.question_answers, 'no answer rows are created for an open question').toEqual(
      [],
    );

    const byId = await api<Question>(page.request, 'GET', `${QUESTIONS_URL}/${created!.id}`);
    expect(byId.type).toBe('open');
    expect(byId.question_answers).toEqual([]);

    // ── Expected (EDU-ASG-…): student types text, teacher grades manually ───
    const assignmentId = await createPublishedAssignment(page, created!.id, student.id);

    const studentContext = await browser.newContext({ baseURL });
    try {
      const studentPage = await studentContext.newPage();
      const studentErrors: string[] = [];
      studentPage.on('pageerror', (error) => studentErrors.push(error.message));

      await loginAs(studentPage, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
      await studentPage.goto(`/app/assignments/${assignmentId}`);
      await expect(
        studentPage.getByRole('heading', { name: ASSIGNMENT_TITLE, exact: true }),
      ).toBeVisible();

      await studentPage.getByRole('button', { name: COPY.startQuiz }).click();
      await expect(studentPage).toHaveURL(/\/take\?attemptId=/);

      await expect(
        studentPage.getByText(QUESTION_CONTENT, { exact: true }),
        'the quiz shows the open question text',
      ).toBeVisible();
      // The product renders „Wpisz swoją odpowiedź…” (the harness normalises the
      // ellipsis), so the placeholder is matched by its stable prefix.
      const answerBox = studentPage.getByPlaceholder(/Wpisz swoją odpowiedź/);
      await expect(answerBox, 'an open question is answered in a free-text box').toBeVisible();
      await expect(
        studentPage.getByRole('radio'),
        'an open question has no selectable answer options',
      ).toHaveCount(0);

      await answerBox.fill(STUDENT_ANSWER);
      await studentPage.getByRole('button', { name: COPY.submitQuiz }).click();

      await expect(studentPage).toHaveURL(new RegExp(`/app/assignments/${assignmentId}$`));
      await expect(
        studentPage.getByText(COPY.completed, { exact: true }),
        'the submitted open answer completes the quiz',
      ).toBeVisible();

      const answers = await api<StudentAnswers>(
        page.request,
        'GET',
        `${TEACHER_ASSIGNMENTS_URL}/${assignmentId}/results/${student.id}`,
      );
      const answer = answers.quiz_answers.find(
        (row) => row.question_id === created!.id && row.text_answer === STUDENT_ANSWER,
      );
      expect(answer, 'the free text is stored as the student answer').toBeDefined();
      expect(answer!.selected_option_id, 'no option is selected for an open answer').toBeNull();
      expect(answers.graded_at, 'the answer still waits for the teacher').toBeNull();

      // The teacher grades the submitted text by hand.
      await page.goto(`/edu/assignments/${assignmentId}/results/${student.id}`);
      await expect(
        page.getByRole('heading', { name: COPY.gradingTitle, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(`Wyjaśnienie: ${EXPLANATION}`, { exact: true }),
        'the grading view shows the model answer',
      ).toBeVisible();
      await expect(
        page.getByText(`Odpowiedź ucznia: ${STUDENT_ANSWER}`, { exact: true }),
        'the grading view shows the student’s text',
      ).toBeVisible();

      const points = page.locator('input[type="number"]');
      await expect(points).toHaveAttribute('max', '1');
      await points.fill('1');
      await page.getByRole('button', { name: COPY.saveGrade }).click();

      await expect(
        page.getByText(/Wynik: 1\/1 \(ocenione\)/),
        'the manual grade is reflected in the header',
      ).toBeVisible();

      const graded = await api<StudentAnswers>(
        page.request,
        'GET',
        `${TEACHER_ASSIGNMENTS_URL}/${assignmentId}/results/${student.id}`,
      );
      const gradedAnswer = graded.quiz_answers.find((row) => row.question_id === created!.id);
      expect(gradedAnswer!.teacher_points, 'the teacher’s points are stored').toBe(1);
      expect(graded.graded_at, 'the attempt is marked graded').not.toBeNull();
      expect(gradedAnswer!.text_answer, 'the student text is kept after grading').toBe(
        STUDENT_ANSWER,
      );

      expect(studentErrors, 'uncaught page errors for the student').toEqual([]);
    } finally {
      await studentContext.close();
    }

    expect(pageErrors, 'uncaught page errors during the walk').toEqual([]);
  });
});
