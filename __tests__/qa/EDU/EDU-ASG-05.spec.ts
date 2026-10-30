import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

/**
 * EDU-ASG-05 — unpublishing a quiz (`/edu/assignments/:id` → „Cofnij publikację”).
 *
 * Case steps: click „Cofnij publikację”, then check the student view.
 *
 * Tenant (deterministic, `content` profile, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts EDU-ASG-05 --fresh
 *
 * gives the org `qa-edu-asg-05-<suffix>` with a manager, an educator and a student,
 * plus the default group `G1` (`tenantKey('qa/cases/EDU-ASG-05.md',
 * 'EDU-ASG-05#<suffix>', 'qa-shared')` + `tenantId` for every id). Nothing global
 * is read or written: no admin setting, feature flag, plan, platform stat or
 * singleton row.
 *
 * The case was written against the legacy manual seed (`teacher-classroom@dev.local`,
 * `student-classroom@dev.local`, group „Classroom Group”). In the tenant model the
 * spec builds the prerequisite — a published quiz without completed attempts —
 * through the product API inside its own tenant: one bank, one question, one
 * assignment targeted at the tenant student, then publish. Every step is
 * idempotent, so CI can retry the spec on the same seeded tenant.
 *
 * Acceptance points (confirmed on the shared app during the walk):
 * 1. The detail screen of a published quiz shows the „Opublikowane” badge and the
 *    „Cofnij publikację” button.
 * 2. The student sees the quiz under „Oczekujące” while it is published.
 * 3. „Cofnij publikację” turns the badge into „Szkic”, removes the button, and
 *    offers the draft actions („Edytuj” / „Usuń”).
 * 4. The quiz list shows the „Szkic” badge for the same quiz.
 * 5. The student list no longer contains the quiz („Brak kartkówek”), the student
 *    API no longer returns it, and its direct student URL is a 404.
 *
 * Not asserted: the case's second bullet („Dla kartkówki z ukończonymi próbami
 * zanotuj zachowanie”) explicitly asks the tester to *record* one of two accepted
 * behaviors, so it is not a pass/fail criterion. The prerequisite this spec
 * encodes is the one the case names: a published quiz **without** completed
 * attempts.
 */

const CASE = 'EDU-ASG-05';

/** Polish copy from `EduAssignmentsPage` / `EduAssignmentDetailPage` / `AppAssignmentsPage`. */
const COPY = {
  published: 'Opublikowane',
  draft: 'Szkic',
  unpublish: 'Cofnij publikację',
  edit: 'Edytuj',
  delete: 'Usuń',
  studentEmpty: 'Brak kartkówek',
  studentNotFound: 'Nie znaleziono kartkówki',
} as const;

/** The quiz the spec prepares in its own tenant; names are case-scoped. */
const BANK_NAME = 'EDU-ASG-05 bank';
const QUESTION_CONTENT = 'EDU-ASG-05 pytanie';
const ASSIGNMENT_TITLE = 'EDU-ASG-05 kartkówka';

const BANKS_URL = '/api/v1/questions/banks';
const QUESTIONS_URL = '/api/v1/questions';
const ASSIGNMENTS_URL = '/api/v1/teacher/assignments';

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface BankListResult {
  items: Array<{ id: string; name: string }>;
}

interface Question {
  id: string;
  content: string;
}

interface AssignmentSummary {
  id: string;
  title: string;
  status: 'draft' | 'published';
}

interface AssignmentDetail extends AssignmentSummary {
  assignment_questions: Array<{ question_id: string }>;
}

/** Send one product-API request and unwrap the `{ success, data }` envelope. */
async function api<T>(
  request: APIRequestContext,
  method: 'GET' | 'POST' | 'PUT',
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

/**
 * The tenant's bank for this case. Reused when it already exists, so a re-run on
 * the same seeded tenant (CI retries) does not pile up duplicates.
 */
async function ensureBank(page: Page): Promise<string> {
  const banks = await api<BankListResult>(page.request, 'GET', `${BANKS_URL}?limit=100`);
  const existing = banks.items.find((bank) => bank.name === BANK_NAME);
  if (existing) return existing.id;

  const created = await api<{ id: string }>(page.request, 'POST', BANKS_URL, {
    name: BANK_NAME,
    description: 'Kartkówka dla EDU-ASG-05',
  });
  return created.id;
}

/** One multiple-choice question in the case's bank, reused when it already exists. */
async function ensureQuestion(page: Page, bankId: string): Promise<string> {
  const questions = await api<Question[]>(page.request, 'GET', `${QUESTIONS_URL}?bankId=${bankId}`);
  const existing = questions.find((question) => question.content === QUESTION_CONTENT);
  if (existing) return existing.id;

  const created = await api<Question>(page.request, 'POST', QUESTIONS_URL, {
    bankId,
    type: 'mcq',
    content: QUESTION_CONTENT,
    answers: [
      { content: 'Odpowiedź A', isCorrect: true, orderIndex: 0 },
      { content: 'Odpowiedź B', isCorrect: false, orderIndex: 1 },
    ],
  });
  return created.id;
}

/**
 * Prepare the case's prerequisite: a published assignment targeted at the tenant
 * student, with no completed attempts. Every write is idempotent — an earlier
 * failed run's assignment is reused and republished, so CI retries start from the
 * same published state instead of a leftover draft.
 */
async function preparePublishedAssignment(page: Page, studentId: string): Promise<string> {
  const bankId = await ensureBank(page);
  const questionId = await ensureQuestion(page, bankId);

  const assignments = await api<AssignmentSummary[]>(page.request, 'GET', ASSIGNMENTS_URL);
  let assignment = assignments.find((candidate) => candidate.title === ASSIGNMENT_TITLE);
  if (!assignment) {
    assignment = await api<AssignmentSummary>(page.request, 'POST', ASSIGNMENTS_URL, {
      title: ASSIGNMENT_TITLE,
    });
  }

  const detail = await api<AssignmentDetail>(
    page.request,
    'GET',
    `${ASSIGNMENTS_URL}/${assignment.id}`,
  );
  if (!detail.assignment_questions.some((row) => row.question_id === questionId)) {
    await api(page.request, 'POST', `${ASSIGNMENTS_URL}/${assignment.id}/questions`, {
      questionIds: [questionId],
    });
  }

  await api(page.request, 'PUT', `${ASSIGNMENTS_URL}/${assignment.id}/targets`, {
    studentIds: [studentId],
  });
  if (assignment.status !== 'published') {
    await api(page.request, 'POST', `${ASSIGNMENTS_URL}/${assignment.id}/publish`, {});
  }

  const published = await api<AssignmentDetail>(
    page.request,
    'GET',
    `${ASSIGNMENTS_URL}/${assignment.id}`,
  );
  expect(published.status, 'the prerequisite quiz is published').toBe('published');
  return assignment.id;
}

test.describe('@case:EDU-ASG-05 @area:EDU @prio:P1 unpublish a quiz', () => {
  test('„Cofnij publikację” returns the quiz to draft and hides it from the student', async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    const student = tenant.users.student;
    if (!student) {
      throw new Error(`${CASE} needs the content tenant profile (org, group and student)`);
    }

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // --- Prerequisite: a published quiz without completed attempts ----------
    await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu(\/|$)/ });
    const assignmentId = await preparePublishedAssignment(page, student.id);

    // --- Step 0: the teacher list marks it as published --------------------
    await page.goto('/edu/assignments');
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
    const teacherCard = page.locator(`a[href="/edu/assignments/${assignmentId}"]`);
    await expect(teacherCard).toBeVisible();
    await expect(teacherCard).toContainText(ASSIGNMENT_TITLE);
    await expect(teacherCard).toContainText(COPY.published);

    // --- The student sees it before the unpublish --------------------------
    const studentContext = await browser.newContext({ baseURL });
    const studentPage = await studentContext.newPage();
    try {
      await loginAs(studentPage, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
      await studentPage.goto('/app/assignments');
      const studentCard = studentPage.locator(`a[href="/app/assignments/${assignmentId}"]`);
      await expect(studentCard).toBeVisible();
      await expect(studentCard).toContainText(ASSIGNMENT_TITLE);

      // --- Step 1: open the quiz and click „Cofnij publikację” --------------
      await teacherCard.click();
      await expect(page).toHaveURL(new RegExp(`/edu/assignments/${assignmentId}$`));
      await expect(
        page.getByRole('heading', { name: ASSIGNMENT_TITLE, exact: true }),
      ).toBeVisible();
      await expect(page.locator('h1 + span')).toHaveText(COPY.published);

      const unpublishButton = page.getByRole('button', { name: COPY.unpublish, exact: true });
      await expect(unpublishButton).toBeVisible();
      const unpublishResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().endsWith(`/api/v1/teacher/assignments/${assignmentId}/unpublish`),
      );
      await unpublishButton.click();
      expect((await unpublishResponse).status(), 'POST …/unpublish').toBe(200);

      // Status returns to „Szkic”; the published-only action disappears and the
      // draft actions take its place.
      await expect(page.locator('h1 + span')).toHaveText(COPY.draft);
      await expect(unpublishButton).toHaveCount(0);
      await expect(page.getByRole('button', { name: COPY.edit, exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: COPY.delete, exact: true })).toBeVisible();

      const detail = await api<AssignmentDetail>(
        page.request,
        'GET',
        `${ASSIGNMENTS_URL}/${assignmentId}`,
      );
      expect(detail.status, 'the teacher API reports the quiz as draft').toBe('draft');

      // The list agrees with the detail screen.
      await page.goto('/edu/assignments');
      await expect(teacherCard).toContainText(COPY.draft);
      await expect(teacherCard).not.toContainText(COPY.published);

      // --- Step 2: the student view ----------------------------------------
      await studentPage.goto('/app/assignments');
      await expect(studentCard, 'the unpublished quiz is gone from the student list').toHaveCount(
        0,
      );
      await expect(
        studentPage.getByText(COPY.studentEmpty, { exact: true }),
        'the student sees the empty state',
      ).toBeVisible();

      const studentAssignments = await api<Array<{ id: string }>>(
        studentPage.request,
        'GET',
        '/api/v1/assignments',
      );
      expect(
        studentAssignments.map((item) => item.id),
        'the student assignment API does not return the unpublished quiz',
      ).not.toContain(assignmentId);

      const direct = await studentPage.request.get(`/api/v1/assignments/${assignmentId}`);
      expect(direct.status(), 'the student cannot fetch the unpublished quiz').toBe(404);

      await studentPage.goto(`/app/assignments/${assignmentId}`);
      await expect(
        studentPage.getByText(COPY.studentNotFound, { exact: true }),
        'the direct student URL is a not-found screen',
      ).toBeVisible();
    } finally {
      await studentContext.close();
    }

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });
});
