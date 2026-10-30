import { expect, test, type Page } from '@playwright/test';
import { createQaSupabase } from '@qa/fixtures/qa-db';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * STU-12 — Historia quizów (student, `/app`).
 *
 * Case: a zero-history student opens the quiz page and „Zobacz pełną historię”,
 * then a student with attempts sees their quiz history — completed attempts with
 * score and date plus a „Przejrzyj” action, and the unfinished attempt as the
 * „Quiz w trakcie” entry with its resume action — and the full-history page lists
 * the completed attempt.
 *
 * Tenant (deterministic, one per independent run):
 *
 *   bun scripts/qa-tenant.ts STU-12 --fresh
 *
 * `__tests__/qa/profiles/STU-12.json` declares the default `content` profile: one
 * organization with its default group and its manager/teacher/student. The spec
 * logs in as the tenant's `student` (the case's „TS — konto bez quizów”) and
 * creates every deck-independent fixture through the product's own API against
 * this tenant only: one question bank, one multiple-choice question, then a
 * practice attempt that is submitted correctly and a second attempt that is left
 * in progress. No global setting, feature flag, plan, platform stat or singleton
 * row is read or written, and `--fresh` gives every run its own key.
 *
 * CI seeds that tenant once for the whole case and Playwright retries reuse it,
 * so the test first clears the student's own attempts and banks: a retry must
 * never depend on (or trip over) state the previous attempt left behind.
 *
 * Reconciliation note (walk on the shared app, 2026-10-28): the case's expected
 * list wording („Test praktyczny” type caption, per-row „W trakcie”, „Wznów”)
 * describes the pre-consolidation quiz cards that commit 2e265cfa replaced with
 * the stats hub. The shipped, intended surface — corroborated by the current
 * STU-10/STU-11 cases and by closed issues #324/#350/#351 — is the „Ostatnie
 * quizy” card (score, date, „Przejrzyj”), the „Quiz w trakcie” banner
 * („Kontynuuj” / „Anuluj”) and „Zobacz pełną historię” → „Wyniki”, whose
 * „Historia testów” table carries the attempt (#), score (%) and date. The spec
 * asserts that behaviour; it does not encode the removed labels.
 */

const CASE = 'STU-12';

/** Polish copy from `quiz-content.tsx` / `quizzes-tab.tsx` (pl.json). */
const COPY = {
  recentTitle: 'Ostatnie quizy',
  emptyTitle: 'Brak historii quizów',
  emptyDesc: 'Rozwiąż quiz, aby zobaczyć swoją historię',
  fullHistory: 'Zobacz pełną historię',
  inProgressTitle: 'Quiz w trakcie',
  inProgressDesc: 'Masz niedokończony quiz. Kontynuuj lub anuluj go.',
  continueQuiz: 'Kontynuuj',
  abortQuiz: 'Anuluj',
  review: 'Przejrzyj',
  resultsHeading: 'Wyniki',
  historyTitle: 'Historia testów',
  completedMetric: 'Ukończone testy',
  attempt: 'Podejście',
} as const;

const BANK_NAME = 'Bank STU-12';
const QUESTION_CONTENT = 'Pytanie quizu STU-12';
const QUESTION_ANSWERS = ['Odpowiedź A', 'Odpowiedź B'] as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface QuestionBank {
  id: string;
}

interface Question {
  id: string;
}

interface QuizAttempt {
  id: string;
  completed_at: string | null;
  questions: Array<{
    id: string;
    question_answers: Array<{ id: string; content: string }>;
  }>;
}

interface AttemptRow {
  id: string;
  completed_at: string | null;
}

async function callApi<T>(
  page: Page,
  method: 'post' | 'put' | 'get',
  url: string,
  data?: unknown,
): Promise<T> {
  const response = await (method === 'get'
    ? page.request.get(url)
    : page.request[method](url, { data }));
  const text = await response.text();
  expect(response.ok(), `${method.toUpperCase()} ${url} → ${response.status()} ${text}`).toBe(true);
  const body = JSON.parse(text) as ApiEnvelope<T>;
  expect(body.success, `${method.toUpperCase()} ${url} success`).toBe(true);
  return body.data;
}

/** „Ostatnie quizy” card (the history list on the quiz page). */
function recentCard(page: Page) {
  return page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByText(COPY.recentTitle, { exact: true }) });
}

/** „Quiz w trakcie” banner card. */
function inProgressCard(page: Page) {
  return page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByText(COPY.inProgressTitle, { exact: true }) });
}

async function openQuizPage(page: Page): Promise<void> {
  await page.goto('/app/study/quiz');
  await expect(recentCard(page), 'the quiz history card is rendered').toBeVisible();
}

/**
 * Retry-safety: CI seeds a case tenant **once** and reuses it for every retry,
 * so an attempt that dies mid-run leaves its question bank, history entry and
 * open attempt behind. The next attempt would then no longer see the empty
 * state this case asserts (and the daily/bank quotas would eventually answer
 * 429). Reset just this case's own artefacts — the tenant's student and org —
 * so every attempt starts from the same first-run state.
 *
 * The product has no delete endpoint for quiz attempts, so cleanup goes through
 * the suite's service-role client (the same helper other cases use to touch
 * their own rows). Deleting the bank cascades its questions; deleting the
 * attempt cascades its answers and attempt questions.
 */
async function resetStudentQuizState(tenant: QaTenant): Promise<void> {
  const student = tenant.users.student;
  if (!student) throw new Error(`${CASE} tenant has no student to reset`);
  if (!tenant.org) throw new Error(`${CASE} tenant has no organization to reset`);
  const db = createQaSupabase();

  const attempts = await db.from('quiz_attempts').delete().eq('user_id', student.id).select('id');
  expect(
    attempts.error,
    `delete ${CASE} student quiz attempts: ${attempts.error?.message ?? ''}`,
  ).toBeNull();

  const banks = await db
    .from('question_banks')
    .delete()
    .eq('created_by', student.id)
    .eq('organization_id', tenant.org.id)
    .select('id');
  expect(
    banks.error,
    `delete ${CASE} student question banks: ${banks.error?.message ?? ''}`,
  ).toBeNull();
}

test.describe('@case:STU-12 @area:STU @prio:P2 student quiz history', () => {
  test('shows the empty history, then attempts with score/date/review, the in-progress entry and the full history', async ({
    page,
  }) => {
    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // A retry reuses this tenant, so drop whatever the previous attempt left.
    await resetStudentQuizState(tenant);
    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

    // --- Step 2: a zero-history account sees the documented empty state ----
    await openQuizPage(page);
    await expect(inProgressCard(page), 'no in-progress entry before any attempt').toHaveCount(0);
    await expect(recentCard(page).getByText(COPY.emptyTitle, { exact: true })).toBeVisible();
    await expect(recentCard(page).getByText(COPY.emptyDesc, { exact: true })).toBeVisible();
    await expect(recentCard(page).locator('li'), 'no completed attempts yet').toHaveCount(0);

    // --- Step 1: „Zobacz pełną historię” --------------------------------
    const fullHistoryLink = page.getByRole('link', { name: new RegExp(COPY.fullHistory) });
    await expect(fullHistoryLink).toHaveAttribute('href', '/app/stats/results');
    await fullHistoryLink.click();

    await expect(page).toHaveURL(/\/app\/stats\/results$/);
    await expect(page.getByRole('heading', { level: 1, name: COPY.resultsHeading })).toBeVisible();
    await expect(page.getByText(COPY.emptyTitle, { exact: true })).toBeVisible();
    await expect(page.getByText(COPY.emptyDesc, { exact: true })).toBeVisible();
    await expect(page.locator('table'), 'the empty account has no history table').toHaveCount(0);

    // --- Build the case's prerequisite ("po kilku quizach") ---------------
    // Both attempts belong to this tenant only; the bank and question are
    // created through the product API so the history rows are real attempts,
    // not seeded database rows.
    const bank = await callApi<QuestionBank>(page, 'post', '/api/v1/questions/banks', {
      name: BANK_NAME,
    });
    await callApi<Question>(page, 'post', '/api/v1/questions', {
      bankId: bank.id,
      type: 'mcq',
      content: QUESTION_CONTENT,
      answers: QUESTION_ANSWERS.map((content, index) => ({
        content,
        isCorrect: index === 0,
        orderIndex: index,
      })),
    });

    // Completed practice attempt, answered correctly: 1 of 1.
    const completed = await callApi<QuizAttempt>(page, 'post', '/api/v1/quiz/new', {
      bankId: bank.id,
      questionTypes: ['mcq'],
      questionCount: 1,
    });
    const completedQuestion = completed.questions[0];
    expect(completedQuestion?.id, 'generated attempt question').toBeTruthy();
    await callApi(page, 'post', `/api/v1/quiz/${completed.id}`, {
      answers: [
        {
          questionId: completedQuestion.id,
          selectedAnswerId: completedQuestion.question_answers[0]?.id,
        },
      ],
    });

    // Second attempt left open — the „Quiz w trakcie” entry.
    const inProgress = await callApi<QuizAttempt>(page, 'post', '/api/v1/quiz/new', {
      bankId: bank.id,
      questionTypes: ['mcq'],
      questionCount: 1,
    });
    expect(inProgress.id).not.toBe(completed.id);
    expect(inProgress.completed_at, 'the second attempt stays unfinished').toBeNull();

    // The history endpoint is the source of both the list and the full page;
    // read the completion timestamp back so the displayed date is exact.
    const attempts = await callApi<AttemptRow[]>(page, 'get', '/api/v1/quiz/attempts');
    const completedRow = attempts.find((attempt) => attempt.id === completed.id);
    expect(completedRow?.completed_at, 'the first attempt is completed').toBeTruthy();

    // --- The history list: score, date and „Przejrzyj” --------------------
    await openQuizPage(page);

    await expect(inProgressCard(page)).toBeVisible();
    await expect(
      inProgressCard(page).getByText(COPY.inProgressDesc, { exact: true }),
    ).toBeVisible();
    await expect(
      inProgressCard(page).getByRole('button', { name: COPY.continueQuiz, exact: true }),
    ).toBeVisible();
    await expect(
      inProgressCard(page).getByRole('button', { name: COPY.abortQuiz, exact: true }),
    ).toBeVisible();

    const rows = recentCard(page).locator('li');
    await expect(rows, 'only the completed attempt is listed as history').toHaveCount(1);

    const row = rows.first();
    await expect(row.getByText('1/1', { exact: true })).toBeVisible();
    const expectedDate = new Date(completedRow!.completed_at!).toLocaleDateString('pl-PL');
    await expect(row.getByText(expectedDate, { exact: true })).toBeVisible();
    await expect(row.getByRole('link', { name: COPY.review, exact: true })).toHaveAttribute(
      'href',
      `/app/study/session/quiz/${completed.id}/review`,
    );

    // --- „Przejrzyj” opens the review of that attempt ---------------------
    await row.getByRole('link', { name: COPY.review, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/app/study/session/quiz/${completed.id}/review$`));
    await expect(page.getByText('Wynik: 100%', { exact: true })).toBeVisible();
    await expect(page.getByText('1 z 1 poprawnych', { exact: true })).toBeVisible();
    await expect(page.getByText(QUESTION_CONTENT, { exact: true })).toBeVisible();

    // --- Resume: „Kontynuuj” returns to the unfinished attempt ------------
    await openQuizPage(page);
    await inProgressCard(page)
      .getByRole('button', { name: COPY.continueQuiz, exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/app/study/session/quiz/${inProgress.id}$`));
    await expect(page.getByText('Pytanie 1 z 1', { exact: true })).toBeVisible();
    await expect(page.getByText(QUESTION_CONTENT, { exact: true })).toBeVisible();

    // --- „Zobacz pełną historię” lists the completed attempt --------------
    await page.goto('/app/stats/results');
    await expect(page.getByRole('heading', { level: 1, name: COPY.resultsHeading })).toBeVisible();

    const completedCard = page
      .locator('[data-slot="card"]')
      .filter({ has: page.getByText(COPY.completedMetric, { exact: true }) });
    await expect(completedCard.getByText('1', { exact: true })).toBeVisible();

    await expect(
      page.getByText(COPY.historyTitle, { exact: true }),
      'the full history table is rendered',
    ).toBeVisible();

    const tableRows = page.locator('table tbody tr');
    await expect(tableRows, 'the unfinished attempt is not history').toHaveCount(1);
    const tableRow = tableRows.first();
    await expect(tableRow.getByText(`${COPY.attempt} #1`, { exact: true })).toBeVisible();
    await expect(tableRow.getByText('100%', { exact: true })).toBeVisible();
    await expect(tableRow.getByText(expectedDate, { exact: true })).toBeVisible();

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });
});
