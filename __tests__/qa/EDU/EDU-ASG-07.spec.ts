import { expect, test, type APIResponse, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * EDU-ASG-07 — Wyniki kartkówki: lista uczniów (`/edu/assignments/<id>/results`).
 *
 * Prerequisite (reconciled with the tenant seeder): the case's „SC ukończył
 * kartkówkę” means the tenant's student has a **completed** attempt of an
 * assignment owned by the tenant's educator. The case was written against the
 * legacy manual seed (`teacher-classroom@dev.local`, `student-classroom@dev.local`,
 * password `pass`); the suite version uses this case's own tenant and never the
 * legacy accounts.
 *
 * Tenant (`content` profile — org + manager/teacher/student + default group `G1`,
 * declared in `__tests__/qa/profiles/EDU-ASG-07.json`), fresh run suffix per
 * independent run:
 *
 *   bun scripts/qa-tenant.ts EDU-ASG-07 --fresh
 *
 * gives `qa-edu-asg-07-<suffix>` (`tenantKey('qa/cases/EDU-ASG-07.md',
 * 'EDU-ASG-07#<suffix>', 'qa-shared')` + `tenantId` for every org/user/group id).
 * The tenant's `teacher` is an educator and an org member, so it may create its own
 * assignments (`assignment.*` = `own`); `teacher_assignments` is scoped by
 * `organization_id`, and `getResults` is gated by `created_by`, so the results list
 * only ever contains this tenant's attempts. The `student` is an org member and a
 * `G1` member, i.e. the assignment's group target. Nothing global is written: the
 * bank, question, assignment, target and the student's attempt all live in this
 * tenant and are created through the product API.
 *
 * Entry point: the case's „W szczegółach kliknij «Wyniki» / «Zobacz wyniki»”. The
 * detail page renders both — a „Wyniki” link in the header and the „Zobacz wyniki”
 * action in the question list — and the spec walks the action link.
 *
 * Acceptance points (walked on the shared app before writing the test):
 * 1. The table has the case's six columns, in order: Uczeń, E-mail, Wynik, Status,
 *    Ukończono, Akcje.
 * 2. With no completions the body is the single cell
 *    „Żaden uczeń nie ukończył jeszcze tej kartkówki”.
 * 3. After the targeted student completes the assignment the row shows their name
 *    and e-mail, the score `1/1`, the status „Przesłane” (completed, not graded),
 *    the completion date in the page's locale (`dd.MM.yyyy` in `pl`) and the
 *    „Oceń” action.
 * 4. „Oceń” opens the per-student grading page („Oceń ucznia”) for that attempt.
 *
 * The status vocabulary itself is part of the surface: „Ocenione” needs a graded
 * open answer and „W trakcie” a running attempt, neither of which the case's
 * single prerequisite („SC ukończył kartkówkę”) provides, so the spec asserts the
 * state the prerequisite creates instead of inventing extra fixtures.
 */

const CASE = 'EDU-ASG-07';

const ASSIGNMENT_TITLE = 'EDU-ASG-07 kartkówka';
const BANK_NAME = 'EDU-ASG-07 bank';
const QUESTION_CONTENT = 'Ziemia jest kulista';
const CORRECT_ANSWER = 'Prawda';

/** Polish copy from `EduAssignmentResultsPage` / `EduAssignmentDetailPage` (pl.json). */
const COPY = {
  resultsTitle: 'Wyniki',
  resultsSubtitle: 'Wyniki uczniów i status ukończenia',
  backToAssignment: 'Powrót do kartkówki',
  viewResults: 'Zobacz wyniki',
  empty: 'Żaden uczeń nie ukończył jeszcze tej kartkówki',
  submitted: 'Przesłane',
  grade: 'Oceń',
  gradingTitle: 'Oceń ucznia',
} as const;

const COLUMNS = ['Uczeń', 'E-mail', 'Wynik', 'Status', 'Ukończono', 'Akcje'] as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface StartedAttempt {
  id: string;
  questions: Array<{
    id: string;
    content: string;
    question_answers: Array<{ id: string; content: string }>;
  }>;
}

interface ResultRow {
  id: string;
  user_id: string;
  score: number;
  total_questions: number;
  total_points: number | null;
  completed_at: string | null;
  graded_at: string | null;
  user: { id: string; email: string; full_name: string | null };
}

function account(tenant: QaTenant, role: 'teacher' | 'student') {
  const user = tenant.users[role];
  if (!user) {
    throw new Error(
      `EDU-ASG-07 fixture incomplete: no ${role}. Run \`bun scripts/qa-tenant.ts ${CASE} --fresh\``,
    );
  }
  return user;
}

async function expectApi<T>(response: APIResponse, label: string) {
  expect(response.status(), label).toBeLessThan(300);
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(body.success, `${label} response`).toBe(true);
  return body.data;
}

/**
 * The case's prerequisite, built through the product API inside this tenant: one
 * true/false question, an assignment targeting the tenant's group, published.
 */
async function createPublishedAssignment(
  page: Page,
  tenant: QaTenant,
): Promise<{ assignmentId: string; questionId: string }> {
  const groupId = tenant.group?.id;
  expect(groupId, 'the content tenant has a default group').toBeTruthy();

  const bank = await expectApi<{ id: string }>(
    await page.request.post('/api/v1/questions/banks', { data: { name: BANK_NAME } }),
    'POST /api/v1/questions/banks',
  );

  const question = await expectApi<{ id: string }>(
    await page.request.post('/api/v1/questions', {
      data: {
        bankId: bank.id,
        type: 'true_false',
        content: QUESTION_CONTENT,
        answers: [
          { content: CORRECT_ANSWER, isCorrect: true, orderIndex: 0 },
          { content: 'Fałsz', isCorrect: false, orderIndex: 1 },
        ],
      },
    }),
    'POST /api/v1/questions',
  );

  const assignment = await expectApi<{ id: string }>(
    await page.request.post('/api/v1/teacher/assignments', {
      data: { title: ASSIGNMENT_TITLE },
    }),
    'POST /api/v1/teacher/assignments',
  );

  await expectApi<unknown>(
    await page.request.post(`/api/v1/teacher/assignments/${assignment.id}/questions`, {
      data: { questionIds: [question.id] },
    }),
    'POST /api/v1/teacher/assignments/:id/questions',
  );

  // Targets are replaced with PUT; publish refuses an assignment without targets.
  await expectApi<unknown>(
    await page.request.put(`/api/v1/teacher/assignments/${assignment.id}/targets`, {
      data: { groupIds: [groupId] },
    }),
    'PUT /api/v1/teacher/assignments/:id/targets',
  );

  const published = await expectApi<{ status: string }>(
    await page.request.post(`/api/v1/teacher/assignments/${assignment.id}/publish`, {
      data: {},
    }),
    'POST /api/v1/teacher/assignments/:id/publish',
  );
  expect(published.status, 'the assignment is published').toBe('published');

  return { assignmentId: assignment.id, questionId: question.id };
}

/** „SC ukończył kartkówkę”: the tenant's student starts and submits the attempt. */
async function completeAssignment(
  studentPage: Page,
  assignmentId: string,
  questionId: string,
): Promise<void> {
  const attempt = await expectApi<StartedAttempt>(
    await studentPage.request.post(`/api/v1/assignments/${assignmentId}/start`, { data: {} }),
    'POST /api/v1/assignments/:id/start',
  );
  expect(attempt.questions.length, 'the assignment serves its one question').toBe(1);

  const question = attempt.questions[0];
  expect(question.id, 'the served question is the assignment question').toBe(questionId);
  // `shuffle_answers` is on by default, so the correct option is picked by content.
  const correct = question.question_answers.find((answer) => answer.content === CORRECT_ANSWER);
  expect(correct, `the served question has the „${CORRECT_ANSWER}” option`).toBeTruthy();

  const submitted = await expectApi<unknown>(
    await studentPage.request.post(`/api/v1/quiz/${attempt.id}`, {
      data: {
        attemptId: attempt.id,
        answers: [{ questionId: question.id, selectedAnswerId: correct!.id }],
      },
    }),
    'POST /api/v1/quiz/:attemptId',
  );
  expect(submitted, 'the attempt is submitted').toBeTruthy();
}

function resultsTable(page: Page) {
  return page.locator('table').first();
}

test.describe('@case:EDU-ASG-07 @area:EDU @prio:P2 assignment results', () => {
  test('lists the student who completed the quiz and its empty state', async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const tenant = loadTenant(CASE);
    console.log(`EDU-ASG-07 tenant key: ${tenant.key}`);
    const student = account(tenant, 'student');

    // --- Prerequisite: the tenant's educator, signed in, Polish UI -----------
    await loginAs(page, tenant, 'teacher', { locale: 'pl' });
    expect(new URL(page.url()).pathname, 'educator lands on /edu').toBe('/edu');

    const { assignmentId, questionId } = await createPublishedAssignment(page, tenant);
    const resultsPath = `/edu/assignments/${assignmentId}/results`;

    // --- Step 1: from the assignment details, open „Zobacz wyniki” -----------
    await page.goto(`/edu/assignments/${assignmentId}`);
    await expect(
      page.getByRole('heading', { level: 1, name: ASSIGNMENT_TITLE, exact: true }),
    ).toBeVisible();
    // The header offers the same destination under the case's other label; the
    // sidebar's „Wyniki” points at the stats page, so pin the href and the label.
    await expect(
      page.locator(`a[href="${resultsPath}"]`).filter({
        has: page.getByRole('button', { name: COPY.resultsTitle, exact: true }),
      }),
    ).toHaveCount(1);

    const viewResults = page.getByRole('link', { name: COPY.viewResults, exact: true });
    await expect(viewResults).toHaveAttribute('href', resultsPath);
    await viewResults.click();
    await page.waitForURL(new RegExp(`${resultsPath}$`), { timeout: 20_000 });

    // --- Expected result: the results screen, six columns, empty state -------
    await expect(
      page.getByRole('heading', { level: 1, name: COPY.resultsTitle, exact: true }),
    ).toBeVisible();
    await expect(page.getByText(COPY.resultsSubtitle, { exact: true })).toBeVisible();
    await expect(
      page.getByRole('link', { name: COPY.backToAssignment, exact: true }),
    ).toHaveAttribute('href', `/edu/assignments/${assignmentId}`);

    await expect(resultsTable(page).locator('thead th')).toHaveText([...COLUMNS]);
    await expect(page.getByText(COPY.empty, { exact: true })).toBeVisible();
    await expect(resultsTable(page).locator('tbody tr')).toHaveCount(1);

    // --- Prerequisite („SC ukończył kartkówkę”): the student submits ---------
    const studentContext = await browser.newContext({
      baseURL: baseURL ?? 'http://localhost:3010',
    });
    try {
      const studentPage = await studentContext.newPage();
      await loginAs(studentPage, tenant, 'student', { locale: 'pl' });
      expect(new URL(studentPage.url()).pathname, 'student lands on /app').toBe('/app');
      await completeAssignment(studentPage, assignmentId, questionId);
    } finally {
      await studentContext.close();
    }

    // --- Expected result: the completed student's row ------------------------
    // `useApiQuery` keeps the empty list cached for the whole session, so a fresh
    // load is how a teacher sees a completion that happened meanwhile.
    await page.reload();
    await expect(page.getByText(COPY.empty, { exact: true })).toHaveCount(0);

    const resultsResponse = await page.request.get(
      `/api/v1/teacher/assignments/${assignmentId}/results`,
    );
    const rows = await expectApi<ResultRow[]>(resultsResponse, 'GET …/results');
    expect(rows, 'exactly the one completed attempt').toHaveLength(1);
    const [attempt] = rows;
    expect(attempt.user.email, 'the row belongs to the tenant student').toBe(student.email);
    expect(attempt.user.full_name, 'the attempt carries the student name').toBeTruthy();
    expect(attempt.completed_at, 'the attempt is completed').toBeTruthy();
    expect(attempt.graded_at, 'the attempt is not graded yet').toBeNull();

    const row = resultsTable(page).locator('tbody tr').filter({ hasText: student.email });
    await expect(row, 'one row for the student').toHaveCount(1);

    const cells = row.locator('td');
    await expect(cells.nth(0), 'Uczeń').toHaveText(attempt.user.full_name!);
    await expect(cells.nth(1), 'E-mail').toHaveText(student.email);
    await expect(cells.nth(2), 'Wynik').toHaveText(`${attempt.score}/${attempt.total_points}`);
    await expect(cells.nth(3), 'Status').toHaveText(COPY.submitted);
    // The page formats the completion date with the UI locale (`pl` → dd.MM.yyyy).
    await expect(cells.nth(4), 'Ukończono').toHaveText(/^\d{2}\.\d{2}\.\d{4}$/);

    // --- Adjacent path: „Oceń” opens this student's grading page -------------
    const gradeLink = row.getByRole('link', { name: COPY.grade, exact: true });
    await expect(gradeLink, 'Akcje').toHaveAttribute(
      'href',
      `/edu/assignments/${assignmentId}/results/${student.id}`,
    );
    await gradeLink.click();
    await page.waitForURL(new RegExp(`/edu/assignments/${assignmentId}/results/${student.id}$`), {
      timeout: 20_000,
    });
    await expect(
      page.getByRole('heading', { level: 1, name: COPY.gradingTitle, exact: true }),
    ).toBeVisible();
    await expect(page.getByText(`Wynik: ${attempt.score}/${attempt.total_points}`)).toBeVisible();
    await expect(page.getByText(QUESTION_CONTENT, { exact: true })).toBeVisible();
  });
});
