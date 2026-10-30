import { expect, test, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * STU-36 — „Kartkówka – maks. liczba prób” (student `/app/assignments`).
 *
 * Case steps: finish the assignment, then try to start it again — from the list, and
 * through `POST /api/v1/assignments/<id>/start` directly.
 * Expected: no second attempt above the limit (the UI hides the start control or shows
 * an error) and the API rejects the call instead of creating another attempt.
 *
 * Tenant (deterministic, `content` profile, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts STU-36 --fresh
 *
 * gives the org `qa-stu-36-<suffix>` with a manager, an educator and the student this
 * case signs in as, plus the default group `G1` (every id derived from
 * `tenantKey('qa/cases/STU-36.md', 'STU-36#<suffix>', 'qa-shared')` + `tenantId`).
 * The legacy prerequisite (a manually seeded kartkówka with `max_attempts = 1` on
 * `student1@dev.local`) maps onto an assignment this spec builds inside its own tenant:
 * one published kartkówka `maxAttempts: 1` targeting the tenant's group, built by the
 * tenant educator through the product API. Nothing global is read or written — no admin
 * setting, feature flag, plan, platform stat or singleton row, and no other tenant.
 *
 * The fixture is rebuilt at the start of every execution (the previous run's assignment
 * with the case title is deleted, the bank's questions are replaced), so a CI retry on
 * the same seeded tenant (`--retries=2`) starts from a fresh, unattempted assignment
 * instead of inheriting the previous run's used-up attempt.
 *
 * Acceptance points walked on the shared app (:3010, QA worker qa-env-5, 2026-10-29):
 * - Before the attempt the list shows the assignment under „Oczekujące (1)” and the
 *   detail page offers „Rozpocznij kartkówkę”.
 * - The take page renders the question and the „Wyślij” action; submitting returns to
 *   the detail page, which now shows „Ukończono”, „Wynik: 1/1” and „Zobacz podsumowanie”
 *   and no longer renders a start/continue button.
 * - The list moves the row to „Ukończone (1)” with the score; opening it from the list
 *   again still shows no start button.
 * - `POST /api/v1/assignments/<id>/start` answers 429 `RATE_LIMITED` and creates no new
 *   attempt — `attempts_used` stays 1 and the newest attempt is still the completed one.
 */

const CASE = 'STU-36';

/** Fixture copy owned by this case (all rows live in the tenant's own org). */
const ASSIGNMENT_TITLE = 'STU-36 kartkówka';
const ASSIGNMENT_DESCRIPTION = 'STU-36 max attempts';
const BANK_NAME = 'STU-36 bank';
const QUESTION_CONTENT = 'STU-36 pytanie 1';
const CORRECT_ANSWER = 'Odpowiedź poprawna';
const WRONG_ANSWER = 'Odpowiedź błędna';

/** Polish copy from `AppAssignmentsPage` / `AppAssignmentDetailPage` / `AppAssignmentTakePage`. */
const COPY = {
  listTitle: 'Moje kartkówki',
  pending: 'Oczekujące (1)',
  completed: 'Ukończone (1)',
  start: 'Rozpocznij kartkówkę',
  completedCard: 'Ukończono',
  score: 'Wynik: 1/1',
  submit: 'Wyślij',
  review: 'Zobacz podsumowanie',
} as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: string;
}

interface BankRow {
  id: string;
  name: string;
}

interface QuestionRow {
  id: string;
  bank_id: string;
  content: string;
}

interface AssignmentRow {
  id: string;
  title: string;
  max_attempts: number;
  status: string;
}

interface StudentAssignment extends AssignmentRow {
  attempts_used: number;
  attempt: { id: string; completed_at: string | null } | null;
  last_completed_attempt: { id: string; score: number } | null;
}

interface Fixture {
  assignment: AssignmentRow;
  question: QuestionRow;
}

/** `GET` an endpoint as the signed-in user and unwrap the response envelope. */
async function getData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.ok(), `GET ${url} → ${response.status()} ${await response.text()}`).toBe(true);
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data;
}

/** `POST` an endpoint and unwrap the response envelope. */
async function postData<T>(page: Page, url: string, data: unknown): Promise<T> {
  const response = await page.request.post(url, { data });
  expect(response.ok(), `POST ${url} → ${response.status()} ${await response.text()}`).toBe(true);
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(body.success, `POST ${url} success flag`).toBe(true);
  return body.data;
}

/** `PUT` an endpoint and unwrap the response envelope. */
async function putData<T>(page: Page, url: string, data: unknown): Promise<T> {
  const response = await page.request.put(url, { data });
  expect(response.ok(), `PUT ${url} → ${response.status()} ${await response.text()}`).toBe(true);
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(body.success, `PUT ${url} success flag`).toBe(true);
  return body.data;
}

/** `DELETE` an endpoint, asserting the product accepted it. */
async function deleteResource(page: Page, url: string): Promise<void> {
  const response = await page.request.delete(url);
  expect(response.ok(), `DELETE ${url} → ${response.status()} ${await response.text()}`).toBe(true);
}

/**
 * Rebuild the case's prerequisite through the product API as the tenant educator:
 * one published kartkówka with `maxAttempts: 1` targeting the tenant's group, backed by
 * one multiple-choice question in the tenant's own bank. Run-scoped, so the spec can be
 * retried on the same seeded tenant.
 */
async function prepareFixture(page: Page, tenant: QaTenant): Promise<Fixture> {
  if (!tenant.group) throw new Error(`${CASE} needs the content tenant profile (group)`);

  // Drop the previous run's assignment first, so its questions are no longer
  // referenced when the bank is rebuilt.
  const assignments = await getData<AssignmentRow[]>(page, '/api/v1/teacher/assignments');
  for (const existing of assignments.filter((row) => row.title === ASSIGNMENT_TITLE)) {
    await deleteResource(page, `/api/v1/teacher/assignments/${existing.id}`);
  }

  const banks = await getData<{ items: BankRow[] }>(
    page,
    '/api/v1/questions/banks?limit=100&owner=mine',
  );
  const bank =
    banks.items.find((row) => row.name === BANK_NAME) ??
    (await postData<BankRow>(page, '/api/v1/questions/banks', {
      name: BANK_NAME,
      description: 'STU-36 max attempts fixture',
    }));

  for (const question of await getData<QuestionRow[]>(
    page,
    `/api/v1/questions?bankId=${bank.id}`,
  )) {
    await deleteResource(page, `/api/v1/questions/${question.id}`);
  }

  const question = await postData<QuestionRow>(page, '/api/v1/questions', {
    bankId: bank.id,
    type: 'mcq',
    content: QUESTION_CONTENT,
    answers: [
      { content: CORRECT_ANSWER, isCorrect: true, orderIndex: 0 },
      { content: WRONG_ANSWER, isCorrect: false, orderIndex: 1 },
    ],
  });

  const assignment = await postData<AssignmentRow>(page, '/api/v1/teacher/assignments', {
    title: ASSIGNMENT_TITLE,
    description: ASSIGNMENT_DESCRIPTION,
    maxAttempts: 1,
    // Show the score so the result card is assertable; shuffling is off so the one
    // question is deterministic.
    showResults: true,
    shuffleQuestions: false,
    shuffleAnswers: false,
  });

  await postData(page, `/api/v1/teacher/assignments/${assignment.id}/questions`, {
    questionIds: [question.id],
  });
  await putData(page, `/api/v1/teacher/assignments/${assignment.id}/targets`, {
    groupIds: [tenant.group.id],
  });
  const published = await postData<AssignmentRow>(
    page,
    `/api/v1/teacher/assignments/${assignment.id}/publish`,
    {},
  );

  return { assignment: published, question };
}

/** The student assignment payload — the same state the detail and list pages render. */
async function readAssignment(page: Page, id: string): Promise<StudentAssignment> {
  return getData<StudentAssignment>(page, `/api/v1/assignments/${id}`);
}

/** The list card that links to this assignment. */
function assignmentCard(page: Page, id: string) {
  return page.locator(`a[href="/app/assignments/${id}"]`);
}

/** The start/continue controls — the attempt-budget gate this case is about. */
function startControls(page: Page) {
  return page.getByRole('button', {
    name: /^(Rozpocznij kartkówkę|Rozpocznij kolejną próbę|Kontynuuj)$/,
  });
}

test.describe('@case:STU-36 @area:STU @prio:P2 assignment max attempts', () => {
  test('refuses a second attempt after completing a one-attempt kartkówka', async ({ page }) => {
    test.setTimeout(120_000);

    const tenant: QaTenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    if (!tenant.org || !tenant.users.teacher || !tenant.users.student) {
      throw new Error(`${CASE} needs the content tenant profile (org, educator and student)`);
    }

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // --- Fixture: the tenant's educator builds a max-attempts-1 kartkówka ------
    await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu(\/|$)/ });
    const { assignment } = await prepareFixture(page, tenant);
    expect(assignment.max_attempts, 'the fixture is a one-attempt kartkówka').toBe(1);
    expect(assignment.status).toBe('published');

    // --- The student's side -----------------------------------------------------
    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app$/ });

    await page.goto('/app/assignments');
    await expect(page).toHaveURL(/\/app\/assignments$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
    await expect(page.locator('h1'), 'the student assignments hub').toHaveText(COPY.listTitle);

    // The tenant starts with this assignment as its only pending row.
    await expect(page.getByRole('heading', { name: COPY.pending })).toBeVisible();
    const card = assignmentCard(page, assignment.id);
    await expect(card, 'the published kartkówka is listed as pending').toBeVisible();
    await expect(card).toContainText(ASSIGNMENT_TITLE);

    // --- Step 1: complete the kartkówka -----------------------------------------
    await card.click();
    await expect(page).toHaveURL(new RegExp(`/app/assignments/${assignment.id}$`));
    await expect(page.getByRole('heading', { name: ASSIGNMENT_TITLE, exact: true })).toBeVisible();
    await expect(startControls(page), 'the first attempt is still available').toHaveCount(1);

    await startControls(page).click();
    await page.waitForURL(new RegExp(`/app/assignments/${assignment.id}/take\\?attemptId=`));
    const attemptId = new URL(page.url()).searchParams.get('attemptId');
    expect(attemptId, 'the take page carries the attempt id').toBeTruthy();

    await expect(page.getByText(QUESTION_CONTENT, { exact: true })).toBeVisible();
    await page.getByText(CORRECT_ANSWER, { exact: true }).click();
    await expect(
      page.getByRole('radio', { checked: true }),
      'the answer is selected before submitting',
    ).toHaveCount(1);

    await page.getByRole('button', { name: COPY.submit, exact: true }).click();
    await page.waitForURL(new RegExp(`/app/assignments/${assignment.id}$`));

    // The attempt is completed and the result card replaces the start action.
    await expect(page.getByText(COPY.completedCard, { exact: true })).toBeVisible();
    await expect(page.getByText(COPY.score, { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: COPY.review })).toBeVisible();
    await expect(
      startControls(page),
      'no start/continue action after the only attempt',
    ).toHaveCount(0);

    const afterCompletion = await readAssignment(page, assignment.id);
    expect(afterCompletion.max_attempts).toBe(1);
    expect(afterCompletion.attempts_used, 'the completed attempt is counted').toBe(1);
    expect(afterCompletion.attempt?.id, 'the attempt is the one just submitted').toBe(attemptId);
    expect(afterCompletion.attempt?.completed_at, 'the attempt is completed').not.toBeNull();

    // --- Step 2a: try to start again from the list ------------------------------
    await page.goto('/app/assignments');
    await expect(page.getByRole('heading', { name: COPY.completed })).toBeVisible();
    await expect(page.getByRole('heading', { name: COPY.pending }), 'no pending row').toHaveCount(
      0,
    );
    const completedCard = assignmentCard(page, assignment.id);
    await expect(completedCard, 'the kartkówka moved to „Ukończone”').toBeVisible();
    await expect(completedCard).toContainText(ASSIGNMENT_TITLE);
    await expect(completedCard).toContainText('1/1');

    await completedCard.click();
    await expect(page).toHaveURL(new RegExp(`/app/assignments/${assignment.id}$`));
    await expect(startControls(page), 'the list cannot restart the used-up attempt').toHaveCount(0);

    // --- Step 2b: try to start again through the start endpoint directly --------
    const startResponse = await page.request.post(`/api/v1/assignments/${assignment.id}/start`);
    expect(startResponse.status(), 'POST start after the limit').toBe(429);
    const startBody = (await startResponse.json()) as { success: boolean; error: string };
    expect(startBody.success).toBe(false);
    expect(startBody.error).toBe('RATE_LIMITED');

    // No attempt was created: the budget and the newest attempt are unchanged.
    const afterRejectedStart = await readAssignment(page, assignment.id);
    expect(afterRejectedStart.attempts_used, 'the rejected call used no attempt').toBe(1);
    expect(afterRejectedStart.attempt?.id, 'the newest attempt is still the submitted one').toBe(
      attemptId,
    );
    expect(afterRejectedStart.attempt?.completed_at).not.toBeNull();
    await expect(startControls(page), 'the detail page still offers no new attempt').toHaveCount(0);

    expect(pageErrors, 'uncaught page errors on the student assignment pages').toEqual([]);
  });
});
