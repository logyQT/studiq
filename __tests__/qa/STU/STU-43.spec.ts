import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * STU-43 — Statystyki studenta, „Wyniki” (quizy) na `/app/stats/results`.
 *
 * Case steps: open `/app/stats/results`. Expected: the quiz history shows every
 * attempt with its score in %, its date and the „Podejście” label; an account
 * without quizzes shows the empty state.
 *
 * Tenant (deterministic, `org-limit` profile, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts STU-43 --fresh
 *
 * gives the org `qa-stu-43-<suffix>` with a manager, two educators, the `student`
 * this case signs in as, and two `invitee` student accounts that are deliberately
 * **not** org members — `invitee1` is the case's „konto bez quizów”. This is why the
 * profile is `org-limit`: a case has one tenant, and its own tenant would otherwise
 * only give one student, so the empty-state half of the acceptance criteria could
 * not be checked on a CI retry (`--retries`/`--repeat-each` reuse the same tenant and
 * the quiz-taking student already has history). Every id derives from
 * `tenantKey('qa/cases/STU-43.md', 'STU-43#<suffix>', 'qa-shared')`. The case's
 * legacy account (`student-classroom@dev.local`, password `pass`) is never used,
 * and nothing global is read or written — no admin setting, feature flag, plan,
 * platform stat or singleton row.
 *
 * The prerequisite („Konto SC po kilku quizach”) is built through the product API
 * inside this tenant by the student: one personal bank with two multiple-choice
 * questions (found-or-created, so a CI retry reuses them instead of spending the
 * plan's bank quota), then two practice quizzes generated from that bank and
 * submitted — one with both answers correct (100 %) and one with a single correct
 * answer (50 %). Attempts are never deleted, so on a reused tenant the table also
 * contains the earlier runs' rows; every assertion below is therefore computed from
 * `/api/v1/quiz/attempts` and the two attempts this run created are asserted to be
 * the two newest rows.
 *
 * The walk on the shared app (:3010, Polish UI, worker qa-env-4) confirmed:
 * - `/app/stats/results` renders the heading „Wyniki”, three cards — „Ukończone
 *   testy” (completed attempts), „Średni wynik”, „Najlepszy wynik” — and the card
 *   „Historia testów” whose table has the columns Podejście / Wynik / Data.
 * - Each row is labelled positionally („Podejście #1”, „Podejście #2”, …), newest
 *   completion first; the Wynik cell is a badge with the rounded percentage
 *   (`score / gradable_questions`), and Data is the completion date in the `pl`
 *   locale (`29.10.2026`).
 * - Two attempts of 2/2 and 1/2 render as „100%” and „50%” and make the cards read
 *   „Ukończone testy” 2, „Średni wynik” 75 %, „Najlepszy wynik” 100 %.
 * - A student account with no attempts renders the empty state
 *   „Brak historii quizów” / „Rozwiąż quiz, aby zobaczyć swoją historię” and no
 *   table. The case's copy „Brak podejść do testów” is outdated — the shipped
 *   message is a language note (P3), not a functional difference, and the same
 *   copy is used on `/app/study/quiz` („Ostatnie quizy”).
 * - The „Zobacz pełną historię →” link on `/app/study/quiz` opens this page.
 * - API: `POST /api/v1/quiz/new` → 201 with the attempt and its questions,
 *   `POST /api/v1/quiz/<attemptId>` → 200 `{ score, totalQuestions }`,
 *   `GET /api/v1/quiz/attempts` → the attempts with `gradable_questions` (2 for a
 *   two-MCQ practice quiz) and `completed_at`, `GET /api/v1/stats/student` → the
 *   aggregates rendered by the two summary cards.
 */

const CASE = 'STU-43';

const BANKS_URL = '/api/v1/questions/banks';
const QUESTIONS_URL = '/api/v1/questions';
const QUIZ_NEW_URL = '/api/v1/quiz/new';
const ATTEMPTS_URL = '/api/v1/quiz/attempts';
const STUDENT_STATS_URL = '/api/v1/stats/student';

/** Polish copy the page renders (`DashboardLayout` / `AppStatsPage` in pl.json). */
const COPY = {
  heading: 'Wyniki',
  history: 'Historia testów',
  attempt: 'Podejście',
  score: 'Wynik',
  date: 'Data',
  taken: 'Ukończone testy',
  average: 'Średni wynik',
  best: 'Najlepszy wynik',
  empty: 'Brak historii quizów',
  emptyDescription: 'Rozwiąż quiz, aby zobaczyć swoją historię',
  fullHistory: 'Zobacz pełną historię',
} as const;

/** The case rows, built in this case's own tenant. */
const BANK_NAME = 'STU-43 bank';

const QUESTIONS = [
  { content: 'Która planeta jest najbliżej Słońca?', correct: 'Merkury', wrong: 'Wenus' },
  { content: 'Która planeta jest największa?', correct: 'Jowisz', wrong: 'Mars' },
] as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface BankRow {
  id: string;
  name: string;
  created_by: string;
}

interface QuestionOption {
  id: string;
  content: string;
  is_correct: boolean;
}

interface QuestionRow {
  id: string;
  content: string;
  type: string;
  question_answers: QuestionOption[];
}

/** The subset of an in-progress attempt the answer-building needs (no answer key). */
interface AttemptQuestion {
  id: string;
  content: string;
  question_answers: Array<{ id: string; content: string }>;
}

interface GeneratedAttempt {
  id: string;
  questions: AttemptQuestion[];
}

interface QuizAttempt {
  id: string;
  score: number | null;
  total_questions: number;
  gradable_questions: number;
  assignment_id: string | null;
  started_at: string;
  completed_at: string | null;
}

interface StudentStatsResponse {
  totalQuizzes: number;
  avgScore: number | null;
  bestScore: number | null;
}

/** Send one product-API request and unwrap the `{ success, data }` envelope. */
async function api<T>(
  request: APIRequestContext,
  method: 'GET' | 'POST',
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

function studentOf(tenant: QaTenant): NonNullable<QaTenant['users']['student']> {
  const student = tenant.users.student;
  if (!student) throw new Error(`${CASE} needs the org-limit tenant profile (student account)`);
  return student;
}

/** The tenant's bank for this case, reused when a retry already created it. */
async function ensureBank(request: APIRequestContext, studentId: string): Promise<string> {
  const banks = await api<{ items: BankRow[] }>(request, 'GET', `${BANKS_URL}?limit=100`);
  const existing = banks.items.find(
    (bank) => bank.name === BANK_NAME && bank.created_by === studentId,
  );
  if (existing) return existing.id;

  const created = await api<{ id: string }>(request, 'POST', BANKS_URL, {
    name: BANK_NAME,
    visibility: 'personal',
  });
  return created.id;
}

/** One question of the case, reused when a retry already created it. */
async function ensureQuestion(
  request: APIRequestContext,
  bankId: string,
  spec: (typeof QUESTIONS)[number],
): Promise<QuestionRow> {
  const existing = await api<QuestionRow[]>(request, 'GET', `${QUESTIONS_URL}?bankId=${bankId}`);
  const found = existing.find((question) => question.content === spec.content);
  if (found) return found;

  return api<QuestionRow>(request, 'POST', QUESTIONS_URL, {
    bankId,
    type: 'mcq',
    content: spec.content,
    answers: [
      { content: spec.correct, isCorrect: true, orderIndex: 0 },
      { content: spec.wrong, isCorrect: false, orderIndex: 1 },
    ],
  });
}

/** Generate a two-question practice quiz from the case bank. */
async function generateAttempt(
  request: APIRequestContext,
  bankId: string,
): Promise<GeneratedAttempt> {
  const attempt = await api<GeneratedAttempt>(request, 'POST', QUIZ_NEW_URL, {
    bankId,
    questionTypes: ['mcq'],
    questionCount: QUESTIONS.length,
  });
  expect(attempt.questions, 'the generated quiz carries both case questions').toHaveLength(
    QUESTIONS.length,
  );
  expect(
    attempt.questions.map((question) => question.content).sort(),
    'the quiz is generated from the case bank only',
  ).toEqual(QUESTIONS.map((question) => question.content).sort());
  return attempt;
}

/**
 * Submit one answer per question. `correct` says whether the answer for a
 * question (addressed by its content) must be the correct option — the attempt
 * payload never carries the answer key before submission (#331), so the ids come
 * from the bank question the student authored.
 */
async function answerAttempt(
  request: APIRequestContext,
  attempt: GeneratedAttempt,
  bank: QuestionRow[],
  correct: Record<string, boolean>,
): Promise<{ score: number | null; totalQuestions: number }> {
  const answers = attempt.questions.map((question) => {
    const bankQuestion = bank.find((row) => row.content === question.content);
    if (!bankQuestion) throw new Error(`bank has no question “${question.content}”`);
    const option = bankQuestion.question_answers.find(
      (answer) => answer.is_correct === (correct[question.content] ?? false),
    );
    if (!option) throw new Error(`question “${question.content}” has no matching option`);
    return { questionId: question.id, selectedAnswerId: option.id };
  });

  return api<{ score: number | null; totalQuestions: number }>(
    request,
    'POST',
    `/api/v1/quiz/${attempt.id}`,
    { attemptId: attempt.id, answers },
  );
}

async function listAttempts(request: APIRequestContext): Promise<QuizAttempt[]> {
  return api<QuizAttempt[]>(request, 'GET', ATTEMPTS_URL);
}

/** Completed attempts, newest completion first — the order the table renders. */
function completedAttempts(attempts: QuizAttempt[]): Array<QuizAttempt & { completed_at: string }> {
  return attempts
    .filter((attempt): attempt is QuizAttempt & { completed_at: string } =>
      Boolean(attempt.completed_at),
    )
    .sort((a, b) => Date.parse(b.completed_at) - Date.parse(a.completed_at));
}

/** `NN%` as `formatScorePercent` renders a card value; `—` when there is no result. */
function scoreLabel(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)}%`;
}

/** The `pl` date the table renders from an ISO timestamp. */
function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('pl');
}

/** One summary card, addressed by its title. */
function summaryCard(page: Page, title: string): Locator {
  return page
    .locator('main [data-slot="card"]')
    .filter({ has: page.getByText(title, { exact: true }) });
}

test.describe('@case:STU-43 @area:STU @prio:P2 quiz results history', () => {
  test('lists quiz attempts with score, date and „Podejście”, and the empty state', async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(180_000);

    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the org-limit tenant profile`).toBe('org-limit');
    const student = studentOf(tenant);
    const noQuizAccount = tenant.users.invitee1;
    if (!tenant.org || !noQuizAccount) {
      throw new Error(`${CASE} needs the org-limit tenant profile (org, student and invitee1)`);
    }

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

    // --- Prerequisite: the student's bank with two multiple-choice questions ---
    const bankId = await ensureBank(page.request, student.id);
    const bank = [
      await ensureQuestion(page.request, bankId, QUESTIONS[0]),
      await ensureQuestion(page.request, bankId, QUESTIONS[1]),
    ];
    expect(bank[0].type, 'the bank holds a multiple-choice question').toBe('mcq');
    expect(bank[1].question_answers, 'both questions carry their two options').toHaveLength(2);

    // --- Prerequisite: „kilka quizów” — one 100 % and one 50 % attempt --------
    const perfect = await generateAttempt(page.request, bankId);
    const perfectResult = await answerAttempt(page.request, perfect, bank, {
      [QUESTIONS[0].content]: true,
      [QUESTIONS[1].content]: true,
    });
    expect(perfectResult.score, 'the fully correct quiz scores both questions').toBe(2);

    const partial = await generateAttempt(page.request, bankId);
    const partialResult = await answerAttempt(page.request, partial, bank, {
      [QUESTIONS[0].content]: true,
      [QUESTIONS[1].content]: false,
    });
    expect(partialResult.score, 'the half-correct quiz scores one question').toBe(1);

    const attempts = await listAttempts(page.request);
    const completed = completedAttempts(attempts);
    expect(completed[0]?.id, 'the newest completion is the half-correct quiz').toBe(partial.id);
    expect(completed[1]?.id, 'the previous completion is the perfect quiz').toBe(perfect.id);
    expect(completed[0]?.gradable_questions, 'a two-MCQ quiz grades both questions').toBe(2);
    expect(completed[1]?.gradable_questions, 'a two-MCQ quiz grades both questions').toBe(2);
    const stats = await api<StudentStatsResponse>(page.request, 'GET', STUDENT_STATS_URL);

    // --- Step 1: open /app/stats/results --------------------------------------
    await page.goto('/app/stats/results');
    await expect(page).toHaveURL(/\/app\/stats\/results$/);
    await expect(page.getByRole('heading', { level: 1, name: COPY.heading })).toBeVisible();

    // Summary cards: the completed count and the server's aggregates.
    for (const [title, value] of [
      [COPY.taken, String(completed.length)],
      [COPY.average, scoreLabel(stats.avgScore)],
      [COPY.best, scoreLabel(stats.bestScore)],
    ] as const) {
      const card = summaryCard(page, title);
      await expect(card, `the „${title}” card is rendered`).toHaveCount(1);
      await expect(
        card.locator('[data-slot="card-content"]'),
        `the „${title}” card shows ${value}`,
      ).toHaveText(value);
    }

    // The history table: „Podejście” / „Wynik” / „Data” and one row per attempt.
    const history = page
      .locator('main [data-slot="card"]')
      .filter({ has: page.getByText(COPY.history, { exact: true }) });
    await expect(history, 'the „Historia testów” card').toHaveCount(1);
    const table = history.locator('table');
    const header = table.locator('thead');
    for (const label of [COPY.attempt, COPY.score, COPY.date]) {
      await expect(header.getByRole('columnheader', { name: label, exact: true })).toBeVisible();
    }

    const rows = table.locator('tbody tr');
    await expect(rows, 'the table lists every completed attempt').toHaveCount(completed.length);
    for (let index = 0; index < completed.length; index += 1) {
      await expect(
        rows.nth(index).locator('td').first(),
        'the rows are labelled „Podejście #n” in display order',
      ).toHaveText(`${COPY.attempt} #${index + 1}`);
    }

    // The two attempts this run created are the two newest rows, with their %.
    // The half-correct quiz was submitted last, so it is „Podejście #1”.
    for (const [index, attempt, percentage] of [
      [0, completed[0], '50%'],
      [1, completed[1], '100%'],
    ] as const) {
      const row = rows.nth(index);
      await expect(row.locator('[data-slot="badge"]'), `row #${index + 1} score`).toHaveText(
        percentage,
      );
      await expect(
        row.locator('td').nth(2),
        `row #${index + 1} carries the completion date`,
      ).toHaveText(dateLabel(attempt.completed_at));
    }

    // --- Adjacent path: „Zobacz pełną historię →” from the quiz page ---------
    await page.goto('/app/study/quiz');
    await page.getByRole('link', { name: new RegExp(COPY.fullHistory) }).click();
    await expect(page, '„Zobacz pełną historię” opens the results page').toHaveURL(
      /\/app\/stats\/results$/,
    );
    await expect(page.getByRole('heading', { level: 1, name: COPY.heading })).toBeVisible();
    await expect(rows.first(), 'the history is reachable from the quiz page').toBeVisible();

    expect(pageErrors, 'the stats walk raises no uncaught errors').toEqual([]);

    // --- Expected result for „Konto bez quizów” ------------------------------
    // A second student in the same tenant, so the state is stable on CI retries.
    const emptyContext = await browser.newContext({ baseURL });
    try {
      const emptyPage = await emptyContext.newPage();
      await loginAs(emptyPage, tenant, 'invitee1', {
        locale: 'pl',
        activeOrgId: null,
        waitFor: /\/app(\/|$)/,
      });

      const emptyAttempts = await listAttempts(emptyPage.request);
      expect(emptyAttempts, 'the account has never taken a quiz').toEqual([]);
      const emptyStats = await api<StudentStatsResponse>(
        emptyPage.request,
        'GET',
        STUDENT_STATS_URL,
      );
      expect(emptyStats.totalQuizzes, 'no quizzes taken').toBe(0);
      expect(emptyStats.avgScore, 'nothing graded yet').toBeNull();
      expect(emptyStats.bestScore, 'nothing graded yet').toBeNull();

      await emptyPage.goto('/app/stats/results');
      await expect(emptyPage).toHaveURL(/\/app\/stats\/results$/);
      await expect(emptyPage.getByRole('heading', { level: 1, name: COPY.heading })).toBeVisible();
      await expect(
        emptyPage.getByText(COPY.empty, { exact: true }),
        'the empty state headline',
      ).toBeVisible();
      await expect(
        emptyPage.getByText(COPY.emptyDescription, { exact: true }),
        'the empty state hint',
      ).toBeVisible();
      await expect(
        emptyPage.getByText(COPY.history, { exact: true }),
        'no history card without attempts',
      ).toHaveCount(0);
      await expect(
        emptyPage.locator('main table'),
        'no history table without attempts',
      ).toHaveCount(0);
    } finally {
      await emptyContext.close();
    }
  });
});
