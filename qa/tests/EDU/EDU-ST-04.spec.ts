import { expect, test, type APIResponse, type Page } from '@playwright/test';
import { createQaSupabase } from '@qa/fixtures/qa-db';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * EDU-ST-04 — Statystyki – testy (`/edu/stats/quizzes`).
 *
 * Prerequisite (reconciled with the tenant seeder): the case's „Po próbach quizów”
 * means the tenant's **student** — an org member with the `member` role, which is
 * the population `GET /api/v1/stats/teacher/quizzes` aggregates — has attempts of a
 * test owned by the tenant's educator. The case was written against the legacy
 * manual seed (`teacher-classroom@dev.local`, `student-classroom@dev.local`,
 * password `pass`); the suite version uses this case's own tenant and never the
 * legacy accounts.
 *
 * Tenant (`content` profile — org + manager/teacher/student + default group `G1`,
 * declared in `qa/tests/profiles/EDU-ST-04.json`), fresh run suffix per independent
 * run:
 *
 *   bun scripts/qa-tenant.ts EDU-ST-04 --fresh
 *
 * gives `qa-edu-st-04-<suffix>` (`tenantKey('qa/cases/EDU-ST-04.md',
 * 'EDU-ST-04#<suffix>', 'qa-shared')` + `tenantId` for every org/user/group id).
 * The tenant's `teacher` is an educator and an org member, so it may create its own
 * bank, questions, quiz and assignment (`assignment.*` = `own`); the assignment is
 * scoped by `organization_id` and only targets `G1`, so the student is the only one
 * who can take it. Nothing global is written: bank, questions, quiz, assignment and
 * both attempts live inside this tenant and are created through the product API.
 *
 * Acceptance points (walked on the shared app before writing the test):
 * 1. `/edu/stats/quizzes` is headed „Statystyki testów” with the subtitle
 *    „Wyniki studentów we wszystkich testach” and one card „Wydajność testów”
 *    („Średnie wyniki i wskaźniki ukończenia według testu”).
 * 2. With no attempts the card shows the case's empty state „Brak danych testów”
 *    and no table at all.
 * 3. Once the student has attempts the card renders one table with exactly the
 *    case's four columns, in order: Test, Podejścia, Śr. wynik, Ukończenie.
 * 4. The row is the test's name (the quiz behind the assignment), „Podejścia”
 *    counts **started** attempts, „Śr. wynik” averages the completed attempts'
 *    normalised score and „Ukończenie” is completed ÷ started. The spec creates
 *    two attempts — one completed at 1/2 and one started but abandoned — so the
 *    three aggregates are all distinct from a trivial 1 / 100% / 100% row:
 *    `2`, `50%`, `50%`.
 */

const CASE = 'EDU-ST-04';
const PAGE_PATH = '/edu/stats/quizzes';

const QUIZ_NAME = 'EDU-ST-04 Test';
const BANK_NAME = 'EDU-ST-04 bank';
const QUESTION_CORRECT = 'EDU-ST-04 q1';
const QUESTION_WRONG = 'EDU-ST-04 q2';
const CORRECT_OPTION = 'Prawda';
const WRONG_OPTION = 'Fałsz';

/** Polish copy from `TeacherQuizStats` (pl.json). */
const COPY = {
  title: 'Statystyki testów',
  description: 'Wyniki studentów we wszystkich testach',
  cardTitle: 'Wydajność testów',
  cardDescription: 'Średnie wyniki i wskaźniki ukończenia według testu',
  empty: 'Brak danych testów',
} as const;

const COLUMNS = ['Test', 'Podejścia', 'Śr. wynik', 'Ukończenie'] as const;

interface Envelope<T> {
  success: boolean;
  data: T;
}

interface QuizStatsRow {
  id: string;
  title: string | null;
  totalAttempts: number;
  avgScore: number;
  avgCompletionRate: number;
}

interface StartedAttempt {
  id: string;
  questions: Array<{
    id: string;
    content: string;
    question_answers: Array<{ id: string; content: string }>;
  }>;
}

function account(tenant: QaTenant, role: 'teacher' | 'student') {
  const user = tenant.users[role];
  if (!user) {
    throw new Error(
      `${CASE} fixture incomplete: no ${role}. Run \`bun scripts/qa-tenant.ts ${CASE} --fresh\``,
    );
  }
  return user;
}

async function expectApi<T>(response: APIResponse, label: string): Promise<T> {
  const body = (await response.json().catch(() => null)) as Envelope<T> | null;
  expect(response.status(), `${label} → ${response.status()} ${JSON.stringify(body)}`).toBeLessThan(
    300,
  );
  expect(body?.success, `${label} success flag`).toBe(true);
  return body!.data;
}

/**
 * Retry-safety: CI seeds a case tenant **once** and reuses it for every retry, and
 * the stats page aggregates every attempt of the tenant's students. An attempt
 * that dies halfway leaves rows behind, which would turn the empty state into a
 * table (or inflate „Podejścia”). Reset just this tenant's own student's attempts
 * so each attempt of the spec starts from the same state. The product has no
 * "delete my attempt history" action, so cleanup goes through the suite's
 * service-role client — the same helper the other cases use for their own rows.
 */
async function resetAttempts(tenant: QaTenant): Promise<void> {
  const student = account(tenant, 'student');
  const db = createQaSupabase();
  const deleted = await db.from('quiz_attempts').delete().eq('user_id', student.id).select('id');
  expect(
    deleted.error,
    `delete ${CASE} student quiz attempts: ${deleted.error?.message ?? ''}`,
  ).toBeNull();
}

/** The table's container — the page renders exactly one table once it has rows. */
function statsTable(page: Page) {
  return page.locator('table').first();
}

async function openPage(page: Page): Promise<void> {
  await page.goto(PAGE_PATH);
  await expect(page).toHaveURL(new RegExp(`${PAGE_PATH}$`));
  await expect(
    page.getByRole('heading', { level: 1, name: COPY.title, exact: true }),
    'page heading',
  ).toBeVisible();
}

/**
 * The case's prerequisite, built through the product API inside this tenant: two
 * true/false questions, a saved quiz „EDU-ST-04 Test”, and an assignment created
 * from that quiz with `maxAttempts: 3` (so the student can leave one attempt
 * unfinished) and `G1` as its target, then published.
 */
async function createPublishedQuiz(page: Page, tenant: QaTenant): Promise<string> {
  const groupId = tenant.group?.id;
  expect(groupId, 'the content tenant has a default group').toBeTruthy();

  const bank = await expectApi<{ id: string }>(
    await page.request.post('/api/v1/questions/banks', { data: { name: BANK_NAME } }),
    'POST /api/v1/questions/banks',
  );

  const questionIds: string[] = [];
  for (const content of [QUESTION_CORRECT, QUESTION_WRONG]) {
    const question = await expectApi<{ id: string }>(
      await page.request.post('/api/v1/questions', {
        data: {
          bankId: bank.id,
          type: 'true_false',
          content,
          answers: [
            { content: CORRECT_OPTION, isCorrect: true, orderIndex: 0 },
            { content: WRONG_OPTION, isCorrect: false, orderIndex: 1 },
          ],
        },
      }),
      `POST /api/v1/questions (${content})`,
    );
    questionIds.push(question.id);
  }

  const quiz = await expectApi<{ id: string }>(
    await page.request.post('/api/v1/teacher/quizzes', { data: { name: QUIZ_NAME } }),
    'POST /api/v1/teacher/quizzes',
  );

  await expectApi<unknown>(
    await page.request.post(`/api/v1/teacher/quizzes/${quiz.id}/questions`, {
      data: { questionIds },
    }),
    'POST /api/v1/teacher/quizzes/:id/questions',
  );

  // `quizId` copies the quiz's questions into the assignment; `maxAttempts` lets
  // the student start a second attempt after completing the first.
  const assignment = await expectApi<{ id: string }>(
    await page.request.post('/api/v1/teacher/assignments', {
      data: { title: QUIZ_NAME, quizId: quiz.id, maxAttempts: 3 },
    }),
    'POST /api/v1/teacher/assignments',
  );

  // Targets are replaced with PUT; publish refuses an assignment without targets.
  await expectApi<unknown>(
    await page.request.put(`/api/v1/teacher/assignments/${assignment.id}/targets`, {
      data: { groupIds: [groupId] },
    }),
    'PUT /api/v1/teacher/assignments/:id/targets',
  );

  const published = await expectApi<{ status: string }>(
    await page.request.post(`/api/v1/teacher/assignments/${assignment.id}/publish`, { data: {} }),
    'POST /api/v1/teacher/assignments/:id/publish',
  );
  expect(published.status, 'the assignment is published').toBe('published');

  return assignment.id;
}

/** The tenant's student starts an attempt; the assignment serves both questions. */
async function startAttempt(studentPage: Page, assignmentId: string): Promise<StartedAttempt> {
  const attempt = await expectApi<StartedAttempt>(
    await studentPage.request.post(`/api/v1/assignments/${assignmentId}/start`, { data: {} }),
    'POST /api/v1/assignments/:id/start',
  );
  expect(attempt.questions.length, 'the assignment serves its two questions').toBe(2);
  return attempt;
}

/**
 * Answer one question right and the other wrong. `shuffle_answers` is on by
 * default, so the option is picked by content, not by position.
 */
async function submitHalfCorrect(studentPage: Page, attempt: StartedAttempt): Promise<void> {
  const answers = attempt.questions.map((question) => {
    const wanted = question.content === QUESTION_CORRECT ? CORRECT_OPTION : WRONG_OPTION;
    const option = question.question_answers.find((answer) => answer.content === wanted);
    expect(option, `the served „${question.content}” has a „${wanted}” option`).toBeTruthy();
    return { questionId: question.id, selectedAnswerId: option!.id };
  });

  await expectApi<unknown>(
    await studentPage.request.post(`/api/v1/quiz/${attempt.id}`, {
      data: { attemptId: attempt.id, answers },
    }),
    'POST /api/v1/quiz/:attemptId',
  );
}

test.describe('@case:EDU-ST-04 @area:EDU @prio:P2 teacher quiz statistics', () => {
  test('shows the empty state before any quiz attempt', async ({ page }) => {
    test.setTimeout(120_000);
    const tenant = loadTenant(CASE);
    console.log(`${CASE} tenant key: ${tenant.key}`);
    await resetAttempts(tenant);

    await loginAs(page, tenant, 'teacher', { locale: 'pl' });
    expect(new URL(page.url()).pathname, 'educator lands on /edu').toBe('/edu');

    // --- Step 1: open /edu/stats/quizzes ------------------------------------
    await openPage(page);

    // --- Expected result: the empty state, no table -------------------------
    await expect(page.getByText(COPY.description, { exact: true })).toBeVisible();
    await expect(page.getByText(COPY.cardTitle, { exact: true })).toBeVisible();
    await expect(page.getByText(COPY.cardDescription, { exact: true })).toBeVisible();
    await expect(page.getByText(COPY.empty, { exact: true })).toBeVisible();
    await expect(statsTable(page), 'no table without attempts').toHaveCount(0);

    const rows = await expectApi<QuizStatsRow[]>(
      await page.request.get('/api/v1/stats/teacher/quizzes'),
      'GET /api/v1/stats/teacher/quizzes',
    );
    expect(rows, 'the tenant has no quiz attempts yet').toEqual([]);
  });

  test('lists the test with its attempts, average score and completion', async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    const tenant = loadTenant(CASE);
    await resetAttempts(tenant);

    // --- Prerequisite („Po próbach quizów”): the tenant's educator builds a test
    await loginAs(page, tenant, 'teacher', { locale: 'pl' });
    expect(new URL(page.url()).pathname, 'educator lands on /edu').toBe('/edu');
    const assignmentId = await createPublishedQuiz(page, tenant);

    // --- The tenant's student attempts it twice -----------------------------
    const studentContext = await browser.newContext({
      baseURL: baseURL ?? 'http://localhost:3010',
    });
    try {
      const studentPage = await studentContext.newPage();
      await loginAs(studentPage, tenant, 'student', { locale: 'pl' });
      expect(new URL(studentPage.url()).pathname, 'student lands on /app').toBe('/app');

      // Attempt 1: completed with 1 of 2 correct → 50%.
      const completed = await startAttempt(studentPage, assignmentId);
      await submitHalfCorrect(studentPage, completed);

      // Attempt 2: started and abandoned → counted in „Podejścia”, not in
      // „Śr. wynik”, and it halves „Ukończenie”.
      await startAttempt(studentPage, assignmentId);
    } finally {
      await studentContext.close();
    }

    // --- Step 1: open /edu/stats/quizzes ------------------------------------
    // A fresh load is how a teacher sees attempts that happened meanwhile.
    await openPage(page);

    // --- Expected result: the table with the case's four columns ------------
    await expect(statsTable(page).locator('thead th')).toHaveText([...COLUMNS]);
    await expect(statsTable(page).locator('tbody tr'), 'one row per test').toHaveCount(1);

    const row = statsTable(page).locator('tbody tr').first();
    const cells = row.locator('td');
    await expect(cells.nth(0), 'Test').toHaveText(QUIZ_NAME);
    await expect(cells.nth(1), 'Podejścia').toHaveText('2');
    await expect(cells.nth(2), 'Śr. wynik').toHaveText('50%');
    await expect(cells.nth(3), 'Ukończenie').toHaveText('50%');

    // The rendered aggregates come from the endpoint the page reads; pin the
    // arithmetic (1 completed at 1/2 + 1 started) so a UI regression is told
    // apart from a data regression.
    const rows = await expectApi<QuizStatsRow[]>(
      await page.request.get('/api/v1/stats/teacher/quizzes'),
      'GET /api/v1/stats/teacher/quizzes',
    );
    expect(rows, 'exactly the tenant’s one test').toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: QUIZ_NAME,
      totalAttempts: 2,
      avgScore: 50,
      avgCompletionRate: 50,
    });
    expect(rows[0].id, 'the row is keyed by the test name').toBe(QUIZ_NAME);

    // The page never renders the empty state once it has rows.
    await expect(page.getByText(COPY.empty, { exact: true })).toHaveCount(0);
  });
});
