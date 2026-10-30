import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * STU-37 — student summary of a completed, graded quiz (`/app/assignments`).
 *
 * Case steps:
 * 1. open a completed quiz and click „Zobacz podsumowanie”;
 * 2. repeat for a quiz with „Pokaż wyniki” off.
 *
 * Expected: with the switch on, „Wynik: X/Y”, the answers, and the teacher's
 * feedback („Informacja zwrotna: …”); with it off, „Podsumowanie niedostępne”.
 *
 * Prerequisite (reconciled with the tenant seeder): „Ukończona i oceniona
 * kartkówka; w ustawieniach „Pokaż wyniki” włączone/wyłączone.” The legacy
 * manual seed (`student-classroom@dev.local`, password `pass`) is never used.
 *
 *   bun scripts/qa-tenant.ts STU-37 --fresh
 *
 * Tenant: the case's own `content` tenant (`__tests__/qa/profiles/STU-37.json`) —
 * organization `qa-stu-37-<suffix>` with a manager, the educator and the student
 * who sits the quizzes. All ids derive from
 * `tenantKey('qa/cases/STU-37.md', 'STU-37#<suffix>', 'qa-shared')`; the spec
 * creates its own bank, questions, assignments and attempts, so nothing global
 * (admin setting, feature flag, plan, platform stat, singleton row) and no other
 * tenant is touched.
 *
 * Every execution tags its content and titles, so a retry against the same
 * tenant (CI seeds once and retries) only adds assignments the assertions do not
 * depend on; `maxAttempts: 1` keeps them in the „Ukończone” bucket.
 *
 * Acceptance points (walked on the shared app, worker qa-env-6, Polish UI):
 * 1. The completed list card shows `2/3` for the visible quiz and
 *    „Podsumowanie niedostępne” for the hidden one.
 * 2. The visible detail page shows „Wynik: 2/3” and „Zobacz podsumowanie”;
 *    the hidden one shows „Podsumowanie niedostępne” instead of a score and
 *    offers no summary link.
 * 3. „Zobacz podsumowanie” opens `/review`, which shows the score („2 / 3”,
 *    „67 %”), every question with the student's answer, and the teacher's open
 *    answer with „Przyznane punkty: 1” and „Informacja zwrotna: …”.
 * 4. A hidden quiz's review URL answers „Podsumowanie niedostępne”, and the
 *    review API refuses it (403) instead of leaking the graded answers.
 */

const CASE = 'STU-37';

/** Polish copy from `AppAssignmentReviewPage` / `AppAssignmentDetailPage` (pl.json). */
const COPY = {
  hidden: 'Podsumowanie niedostępne',
  viewReview: 'Zobacz podsumowanie',
  completed: 'Ukończono',
  feedbackLabel: 'Informacja zwrotna',
  pointsLabel: 'Przyznane punkty',
  yourAnswer: 'Twoja odpowiedź',
} as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface CreatedQuestion {
  id: string;
  content: string;
  question_answers: Array<{ id: string; content: string; is_correct: boolean }>;
}

interface StudentAssignment {
  id: string;
  title: string;
  show_results: boolean;
  last_completed_attempt: { id: string; score: number | null; total_points: number | null } | null;
}

/** How the student answers the attempt (one right, one wrong, one graded by hand). */
const ANSWERS = {
  mcqCorrect: 'Alfa',
  mcqWrong: 'Beta',
  mcqWrongChosen: 'Delta',
} as const;

/** One request against the product API, with the envelope unwrapped. */
async function api<T>(
  page: Page,
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  data?: unknown,
): Promise<T> {
  const response = await page.request.fetch(url, { method, data });
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(response.ok(), `${method} ${url} → ${response.status()} ${JSON.stringify(body)}`).toBe(
    true,
  );
  expect(body.success, `${method} ${url} success flag`).toBe(true);
  return body.data;
}

/**
 * The case's prerequisite content: a bank with two multiple-choice questions and
 * one open question, then a published assignment per „Pokaż wyniki” state,
 * targeted at the tenant's student. Everything is addressed by returned ids.
 */
async function createQuiz(
  page: Page,
  tenant: QaTenant,
  params: { title: string; showResults: boolean; questionIds: string[] },
): Promise<{ id: string }> {
  const student = tenant.users.student;
  if (!student) throw new Error(`${CASE}: tenant ${tenant.key} has no seeded student`);

  const assignment = await api<{ id: string }>(page, 'POST', '/api/v1/teacher/assignments', {
    title: params.title,
    description: `STU-37 ${params.title}`,
    showResults: params.showResults,
    maxAttempts: 1,
    shuffleQuestions: false,
    shuffleAnswers: false,
  });

  await api<unknown>(page, 'POST', `/api/v1/teacher/assignments/${assignment.id}/questions`, {
    questionIds: params.questionIds,
  });
  await api<unknown>(page, 'PUT', `/api/v1/teacher/assignments/${assignment.id}/targets`, {
    studentIds: [student.id],
  });
  await api<unknown>(page, 'POST', `/api/v1/teacher/assignments/${assignment.id}/publish`, {});

  return assignment;
}

/** The student's completed attempt: one right, one wrong, one open answer. */
async function submitAttempt(
  page: Page,
  assignmentId: string,
  questions: { mcq1: CreatedQuestion; mcq2: CreatedQuestion; open: CreatedQuestion },
  openAnswer: string,
): Promise<{ attemptId: string; score: number | null }> {
  const started = await api<{ id: string }>(
    page,
    'POST',
    `/api/v1/assignments/${assignmentId}/start`,
    {},
  );
  const submitted = await api<{ score: number | null; totalQuestions: number }>(
    page,
    'POST',
    `/api/v1/quiz/${started.id}`,
    {
      attemptId: started.id,
      answers: [
        {
          questionId: questions.mcq1.id,
          selectedAnswerId: questions.mcq1.question_answers.find((answer) => answer.is_correct)!.id,
        },
        {
          questionId: questions.mcq2.id,
          selectedAnswerId: questions.mcq2.question_answers.find((answer) => !answer.is_correct)!
            .id,
        },
        { questionId: questions.open.id, textAnswer: openAnswer },
      ],
    },
  );
  expect(submitted.totalQuestions, 'the attempt holds all three questions').toBe(3);
  return { attemptId: started.id, score: submitted.score };
}

/** The completed-list card of one assignment (its card is the only link to it). */
function listCard(page: Page, assignmentId: string): Locator {
  return page.locator(`main a[href="/app/assignments/${assignmentId}"]`);
}

/** The review question block addressed by its content (options carry no question text). */
function reviewQuestion(page: Page, content: string): Locator {
  return page.locator('main div.rounded-lg.border').filter({ hasText: content });
}

test.describe('@case:STU-37 @area:STU @prio:P2 student summary of a graded quiz', () => {
  test('shows the score, answers and teacher feedback, and hides them when „Pokaż wyniki” is off', async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(180_000);

    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    expect(tenant.org, 'the tenant has an organization').toBeTruthy();
    expect(tenant.users.teacher, 'the tenant seeds the educator').toBeTruthy();
    expect(tenant.users.student, 'the tenant seeds the student').toBeTruthy();

    const teacherErrors: string[] = [];
    page.on('pageerror', (error) => teacherErrors.push(error.message));

    // A per-execution tag keeps repeated runs against the same tenant apart.
    const tag = `${tenant.runSuffix ?? 'stable'}-${Date.now().toString(36)}`;
    const visibleTitle = `${CASE} widoczne ${tag}`;
    const hiddenTitle = `${CASE} ukryte ${tag}`;
    const openAnswer = `Odpowiedź ucznia STU-37 ${tag}`;
    const feedback = `Bardzo dobra odpowiedź ${tag}`;

    // ── Teacher: the two quizzes with their three questions ──────────────────
    await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu(\/|$)/ });
    expect(new URL(page.url()).pathname, 'the educator lands on /edu').toBe('/edu');

    const bank = await api<{ id: string }>(page, 'POST', '/api/v1/questions/banks', {
      name: `${CASE} bank ${tag}`,
    });

    const mcq1 = await api<CreatedQuestion>(page, 'POST', '/api/v1/questions', {
      bankId: bank.id,
      type: 'mcq',
      content: `${CASE} pytanie poprawne ${tag}`,
      answers: [
        { content: ANSWERS.mcqCorrect, isCorrect: true, orderIndex: 0 },
        { content: ANSWERS.mcqWrong, isCorrect: false, orderIndex: 1 },
      ],
    });
    const mcq2 = await api<CreatedQuestion>(page, 'POST', '/api/v1/questions', {
      bankId: bank.id,
      type: 'mcq',
      content: `${CASE} pytanie błędne ${tag}`,
      answers: [
        { content: 'Gamma', isCorrect: true, orderIndex: 0 },
        { content: ANSWERS.mcqWrongChosen, isCorrect: false, orderIndex: 1 },
      ],
    });
    const open = await api<CreatedQuestion>(page, 'POST', '/api/v1/questions', {
      bankId: bank.id,
      type: 'open',
      content: `${CASE} pytanie otwarte ${tag}`,
      answers: [],
    });

    const questions = [mcq1.id, mcq2.id, open.id];
    const visible = await createQuiz(page, tenant, {
      title: visibleTitle,
      showResults: true,
      questionIds: questions,
    });
    const hidden = await createQuiz(page, tenant, {
      title: hiddenTitle,
      showResults: false,
      questionIds: questions,
    });

    // ── Student: sits both quizzes, one attempt each ─────────────────────────
    const studentContext = await browser.newContext({ baseURL });
    try {
      const studentPage = await studentContext.newPage();
      const studentErrors: string[] = [];
      const failedRequests: string[] = [];
      studentPage.on('pageerror', (error) => studentErrors.push(error.message));
      studentPage.on('response', (response) => {
        if (response.status() >= 400 && response.url().includes('/api/v1/')) {
          failedRequests.push(`${response.status()} ${new URL(response.url()).pathname}`);
        }
      });

      await loginAs(studentPage, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });

      const visibleAttempt = await submitAttempt(
        studentPage,
        visible.id,
        { mcq1, mcq2, open },
        openAnswer,
      );
      // 1 of 3 points before the open answer is graded.
      expect(visibleAttempt.score, 'the auto-graded score is reported to the student').toBe(1);

      const hiddenAttempt = await submitAttempt(
        studentPage,
        hidden.id,
        { mcq1, mcq2, open },
        openAnswer,
      );
      expect(
        hiddenAttempt.score,
        'a hidden result is never returned by the submit call',
      ).toBeNull();

      // ── Teacher grades the open answer of the visible quiz ─────────────────
      const student = tenant.users.student!;
      await api<unknown>(
        page,
        'PUT',
        `/api/v1/teacher/assignments/${visible.id}/results/${student.id}`,
        { questionId: open.id, points: 1, feedback },
      );

      // ── Step 1: the completed list and the visible quiz's summary ──────────
      await studentPage.goto('/app/assignments');
      await expect(
        studentPage.getByRole('heading', { level: 1, name: 'Moje kartkówki' }),
        'the student assignments page',
      ).toBeVisible();

      const visibleCard = listCard(studentPage, visible.id);
      await expect(visibleCard, 'the graded quiz is listed as completed').toHaveCount(1);
      await expect(visibleCard.getByText(visibleTitle, { exact: true })).toBeVisible();
      await expect(
        visibleCard.getByText('2/3', { exact: true }),
        'the completed card shows the graded score',
      ).toBeVisible();
      await expect(
        visibleCard.getByText(COPY.hidden, { exact: true }),
        'the visible quiz hides nothing',
      ).toHaveCount(0);

      await visibleCard.click();
      await expect(studentPage).toHaveURL(new RegExp(`/app/assignments/${visible.id}$`));
      await expect(
        studentPage.getByRole('heading', { level: 1, name: visibleTitle }),
        'the visible quiz detail page',
      ).toBeVisible();
      await expect(
        studentPage.getByText('Wynik: 2/3', { exact: true }),
        'the detail page shows the graded score',
      ).toBeVisible();
      await expect(
        studentPage.getByRole('link', { name: COPY.viewReview, exact: true }),
        'the summary link is offered',
      ).toBeVisible();

      await studentPage.getByRole('link', { name: COPY.viewReview, exact: true }).click();
      await expect(studentPage).toHaveURL(
        new RegExp(`/app/assignments/${visible.id}/review\\?attemptId=`),
      );

      // The score header, matching the graded 2 of 3 points.
      await expect(
        studentPage.getByRole('heading', { level: 1 }),
        'the summary heading is the score',
      ).toHaveText('2 / 3');
      await expect(studentPage.getByText('67%', { exact: true })).toBeVisible();

      // Every question is listed with the student's answer.
      const correctBlock = reviewQuestion(studentPage, mcq1.content);
      await expect(correctBlock, 'the correctly answered question').toHaveCount(1);
      await expect(
        correctBlock.locator('[data-correct="true"]'),
        'the correct option is marked',
      ).toHaveCount(1);
      await expect(correctBlock.locator('[data-correct="true"]')).toContainText(ANSWERS.mcqCorrect);
      await expect(correctBlock.getByLabel('Poprawnie').first()).toBeVisible();

      const wrongBlock = reviewQuestion(studentPage, mcq2.content);
      await expect(wrongBlock, 'the incorrectly answered question').toHaveCount(1);
      await expect(
        wrongBlock.locator('[data-selected="true"]'),
        'the wrong choice is marked as selected',
      ).toHaveCount(1);
      await expect(wrongBlock.locator('[data-selected="true"]')).toContainText(
        ANSWERS.mcqWrongChosen,
      );
      await expect(wrongBlock.getByLabel('Niepoprawnie').first()).toBeVisible();

      const openBlock = reviewQuestion(studentPage, open.content);
      await expect(openBlock, 'the open question').toHaveCount(1);
      await expect(openBlock).toContainText(`${COPY.yourAnswer}: ${openAnswer}`);
      await expect(openBlock).toContainText(`${COPY.pointsLabel}: 1`);
      await expect(
        openBlock.getByText(`${COPY.feedbackLabel}: ${feedback}`, { exact: true }),
        'the teacher feedback is shown',
      ).toBeVisible();

      // ── Step 2: the quiz with „Pokaż wyniki” off ───────────────────────────
      await studentPage.goto('/app/assignments');
      const hiddenCard = listCard(studentPage, hidden.id);
      await expect(hiddenCard, 'the hidden quiz is listed as completed').toHaveCount(1);
      await expect(
        hiddenCard.getByText(COPY.hidden, { exact: true }),
        'the completed card withholds the score',
      ).toBeVisible();

      await hiddenCard.click();
      await expect(studentPage).toHaveURL(new RegExp(`/app/assignments/${hidden.id}$`));
      const hiddenDetail = studentPage.locator('main');
      await expect(
        hiddenDetail.getByText(COPY.hidden, { exact: true }),
        'the detail page withholds the summary',
      ).toBeVisible();
      await expect(
        hiddenDetail.getByText(/^Wynik:/),
        'no score is printed while results are hidden',
      ).toHaveCount(0);
      await expect(
        studentPage.getByRole('link', { name: COPY.viewReview, exact: true }),
        'no summary link while results are hidden',
      ).toHaveCount(0);
      await expect(
        hiddenDetail.getByText(COPY.completed, { exact: true }),
        'completion metadata still renders',
      ).toBeVisible();

      // A bookmarked review URL is refused too, without fetching the result.
      await studentPage.goto(`/app/assignments/${hidden.id}/review`);
      await expect(studentPage).toHaveURL(new RegExp(`/app/assignments/${hidden.id}/review$`));
      await expect(
        studentPage.getByText(COPY.hidden, { exact: true }),
        'the review page withholds the summary',
      ).toBeVisible();
      await expect(
        studentPage.getByRole('heading', { level: 1 }),
        'no score heading while results are hidden',
      ).toHaveCount(0);

      expect(failedRequests, 'no API request may fail during the walk').toEqual([]);
      expect(studentErrors, 'uncaught page errors in the student session').toEqual([]);

      // ── Adjacent regression: the API keeps the same switch ────────────────
      const visibleStored = await api<{
        score: number;
        total_points: number;
        answers: Record<string, { teacher_points: number | null; teacher_feedback: string | null }>;
      }>(studentPage, 'GET', `/api/v1/quiz/${visibleAttempt.attemptId}`);
      expect(visibleStored.score, 'the stored score includes the graded answer').toBe(2);
      expect(visibleStored.total_points, 'the total is the assignment points').toBe(3);
      expect(
        visibleStored.answers[open.id].teacher_points,
        'the stored open answer is graded',
      ).toBe(1);
      expect(visibleStored.answers[open.id].teacher_feedback, 'the stored feedback').toBe(feedback);

      const visibleAssignment = await api<StudentAssignment>(
        studentPage,
        'GET',
        `/api/v1/assignments/${visible.id}`,
      );
      expect(
        visibleAssignment.last_completed_attempt?.score,
        'the assignment payload carries the score while results are visible',
      ).toBe(2);

      const hiddenAssignment = await api<StudentAssignment>(
        studentPage,
        'GET',
        `/api/v1/assignments/${hidden.id}`,
      );
      expect(
        hiddenAssignment.last_completed_attempt?.score,
        'the assignment payload withholds the score',
      ).toBeNull();

      const forbidden = await studentPage.request.get(`/api/v1/quiz/${hiddenAttempt.attemptId}`);
      expect(
        forbidden.status(),
        'a direct review request is refused while results are hidden',
      ).toBe(403);
    } finally {
      await studentContext.close();
    }

    expect(teacherErrors, 'uncaught page errors in the teacher session').toEqual([]);
  });
});
