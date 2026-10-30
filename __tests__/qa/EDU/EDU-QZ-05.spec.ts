import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * EDU-QZ-05 — Utworzenie kartkówki z quizu (`/edu/quizzes/:id`).
 *
 * Case step: in the quiz editor or the quiz details click „Utwórz kartkówkę”.
 * Expected: the app opens the new-assignment form with the quiz loaded (the quiz's
 * questions are copied into the assignment).
 *
 * Tenant (deterministic, `content` profile, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts EDU-QZ-05 --fresh
 *
 * gives the org `qa-edu-qz-05-<suffix>` with a manager (org `admin`), an educator (org
 * `member`, the case's „TC” analogue) and a student, plus the default group `G1`
 * (`tenantKey('qa/cases/EDU-QZ-05.md', 'EDU-QZ-05#<suffix>', 'qa-shared')` + `tenantId` for
 * every id). The legacy manual accounts (`teacher-classroom@dev.local`, password `pass`) and
 * its „Classroom” quizy are never used.
 *
 * The prerequisite „Quiz z pytaniami” is built by the spec through the same product endpoints
 * the UI calls: bank „EDU-QZ-05 bank” with three multiple-choice questions and quiz
 * „EDU-QZ-05 quiz” holding them in order. Both are reused when a previous run created them and
 * recreated only when their content no longer matches; assignments titled „EDU-QZ-05 quiz”
 * left by an interrupted run are deleted first, so a retry on the same tenant (CI seeds once)
 * always starts from zero assignments. Nothing global is read or written: no admin setting,
 * feature flag, plan, platform stat or singleton row.
 *
 * Acceptance points (walked on the shared app, worker qa-env-3, `NEXT_LOCALE=pl`):
 * 1. The quiz detail page lists the quiz's three questions and offers „Utwórz kartkówkę”,
 *    linking to `/edu/assignments/new?quizId=<quiz id>`.
 * 2. That form is „Nowa kartkówka” with the title already filled with the quiz name and the
 *    hint „Na podstawie: <quiz name>” — the quiz is loaded, nothing has to be retyped.
 * 3. Saving creates the draft (`Szkic`) whose counters are 3 questions / 3 points, whose list
 *    shows the quiz's questions in the quiz's order with their points, and whose
 *    „Zobacz quiz źródłowy” link leads back to the quiz.
 * 4. The stored assignment carries `quiz_id` and the copied `assignment_questions`
 *    (`question_id`, `order_index`, `points`) — the questions were copied, not just linked.
 *
 * Recorded, not asserted: the quiz *editor* (`/edu/quizzes/:id/edit`) has no „Utwórz
 * kartkówkę” action; only the detail page does. The case allows either location („w edytorze
 * **lub** szczegółach quizu”), so this is a copy/scope note documented in the reconciled case.
 */

const CASE = 'EDU-QZ-05';

const BANKS_URL = '/api/v1/questions/banks';
const QUESTIONS_URL = '/api/v1/questions';
const QUIZZES_URL = '/api/v1/teacher/quizzes';
const ASSIGNMENTS_URL = '/api/v1/teacher/assignments';

/** Polish copy from `EduQuizDetailPage` / `EduAssignmentNewPage` / `EduAssignmentDetailPage`. */
const COPY = {
  createAssignment: 'Utwórz kartkówkę',
  newTitle: 'Nowa kartkówka',
  newSubtitle: 'Utwórz nową kartkówkę dla uczniów',
  basedOn: 'Na podstawie: EDU-QZ-05 quiz',
  draft: 'Szkic',
  sourceQuiz: 'Zobacz quiz źródłowy',
} as const;

/** The prerequisite: a bank of three multiple-choice questions, and the quiz built from them. */
const BANK = { name: 'EDU-QZ-05 bank', description: 'Quiz fixture bank' } as const;
const QUIZ = { name: 'EDU-QZ-05 quiz', description: 'Quiz z pytaniami' } as const;
const QUESTION_CONTENTS = [
  'EDU-QZ-05 pytanie 1',
  'EDU-QZ-05 pytanie 2',
  'EDU-QZ-05 pytanie 3',
] as const;
const MCQ_ANSWERS = [
  { content: 'Poprawna', isCorrect: true, orderIndex: 0 },
  { content: 'Błędna', isCorrect: false, orderIndex: 1 },
] as const;
const POINTS_PER_QUESTION = 1;

const ASSIGNMENT_ID = /\/edu\/assignments\/([0-9a-f-]{36})$/;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
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

interface QuizRow {
  id: string;
  name: string;
}

interface QuizQuestionRow {
  question_id: string;
  order_index: number;
  points: number;
}

interface QuizDetail extends QuizRow {
  quiz_questions: QuizQuestionRow[];
}

interface AssignmentRow {
  id: string;
  title: string;
}

interface AssignmentQuestionRow {
  question_id: string;
  order_index: number;
  points: number;
  question?: { id: string; content: string };
}

interface AssignmentDetail extends AssignmentRow {
  quiz_id: string | null;
  question_count: number;
  total_points: number;
  assignment_questions: AssignmentQuestionRow[];
}

/** `GET` an endpoint as the signed-in teacher and unwrap the response envelope. */
async function getData<T>(api: APIRequestContext, url: string): Promise<T> {
  const response = await api.get(url);
  expect(response.ok(), `GET ${url} → ${response.status()} ${await response.text()}`).toBe(true);
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data;
}

/** `POST` an endpoint and unwrap the response envelope. */
async function postData<T>(api: APIRequestContext, url: string, data: unknown): Promise<T> {
  const response = await api.post(url, { data });
  expect(response.ok(), `POST ${url} → ${response.status()} ${await response.text()}`).toBe(true);
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(body.success, `POST ${url} success flag`).toBe(true);
  return body.data;
}

/** `DELETE` an endpoint, asserting the product accepted it. */
async function deleteResource(api: APIRequestContext, url: string): Promise<void> {
  const response = await api.delete(url);
  expect(response.ok(), `DELETE ${url} → ${response.status()} ${await response.text()}`).toBe(true);
}

/** The case's bank, reused when a previous run created it (the „Nowy bank” dialog's endpoint). */
async function ensureBank(api: APIRequestContext): Promise<BankRow> {
  const banks = await getData<{ items: BankRow[] }>(api, `${BANKS_URL}?limit=100&owner=mine`);
  const existing = banks.items.find((bank) => bank.name === BANK.name);
  if (existing) return existing;
  return postData<BankRow>(api, BANKS_URL, {
    name: BANK.name,
    description: BANK.description,
  });
}

/** The three questions of the bank, created only when an earlier run did not leave them. */
async function ensureQuestions(api: APIRequestContext, bankId: string): Promise<QuestionRow[]> {
  const existing = await getData<QuestionRow[]>(api, `${QUESTIONS_URL}?bankId=${bankId}`);
  const byContent = new Map(existing.map((question) => [question.content, question]));

  const questions: QuestionRow[] = [];
  for (const content of QUESTION_CONTENTS) {
    questions.push(
      byContent.get(content) ??
        (await postData<QuestionRow>(api, QUESTIONS_URL, {
          bankId,
          type: 'mcq',
          content,
          answers: MCQ_ANSWERS,
        })),
    );
  }
  return questions;
}

/**
 * The quiz holding exactly the case's three questions, in order and at 1 pkt each. A quiz left
 * by an earlier run is reused as-is; one whose questions drifted (a question deleted, a
 * reorder) is replaced, so the prerequisite is the same on every run.
 */
async function ensureQuiz(api: APIRequestContext, questions: QuestionRow[]): Promise<QuizRow> {
  const expectedIds = questions.map((question) => question.id);
  const quizzes = await getData<QuizRow[]>(api, QUIZZES_URL);
  const existing = quizzes.find((quiz) => quiz.name === QUIZ.name);

  if (existing) {
    const detail = await getData<QuizDetail>(api, `${QUIZZES_URL}/${existing.id}`);
    const stored = [...detail.quiz_questions].sort((a, b) => a.order_index - b.order_index);
    const matches =
      stored.length === expectedIds.length &&
      stored.every(
        (row, index) =>
          row.question_id === expectedIds[index] && row.points === POINTS_PER_QUESTION,
      );
    if (matches) return existing;
    await deleteResource(api, `${QUIZZES_URL}/${existing.id}`);
  }

  const quiz = await postData<QuizRow>(api, QUIZZES_URL, {
    name: QUIZ.name,
    description: QUIZ.description,
  });
  await postData<QuizQuestionRow[]>(api, `${QUIZZES_URL}/${quiz.id}/questions`, {
    questionIds: expectedIds,
  });
  return quiz;
}

/**
 * Drop assignments left behind by an interrupted run. Only rows titled with this case's quiz
 * name are touched, and they all belong to this tenant's educator.
 */
async function removeOwnAssignments(api: APIRequestContext): Promise<void> {
  const assignments = await getData<AssignmentRow[]>(api, ASSIGNMENTS_URL);
  for (const assignment of assignments.filter((row) => row.title === QUIZ.name)) {
    await deleteResource(api, `${ASSIGNMENTS_URL}/${assignment.id}`);
  }
}

/** The assignment detail — the same payload the page renders. */
async function readAssignment(api: APIRequestContext, id: string): Promise<AssignmentDetail> {
  return getData<AssignmentDetail>(api, `${ASSIGNMENTS_URL}/${id}`);
}

/** A summary counter card: its text is exactly `<title> <value>` (title and value adjacent). */
function counterCard(page: Page, title: string): Locator {
  return page.locator('[data-slot="card"]').filter({ hasText: new RegExp(`^${title}\\s*\\d+$`) });
}

/** Assert one summary counter (`Pytania` / `Suma punktów`) shows `value`. */
async function expectCounter(page: Page, title: string, value: number): Promise<void> {
  await expect(
    counterCard(page, title).locator('[data-slot="card-content"] p'),
    `the „${title}” counter`,
  ).toHaveText(String(value));
}

/** The assignment's question list: the only card carrying the question type badges. */
function questionListCard(page: Page): Locator {
  return page.locator('[data-slot="card"]').filter({ has: page.locator('[data-slot="badge"]') });
}

test.describe('@case:EDU-QZ-05 @area:EDU @prio:P2 create an assignment from a quiz', () => {
  test('opens the new-assignment form from the quiz and copies its questions', async ({ page }) => {
    const tenant: QaTenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    if (!tenant.org || !tenant.users.teacher) {
      throw new Error(`${CASE} needs the content tenant profile (org and educator)`);
    }

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu(\/|$)/ });
    expect(new URL(page.url()).pathname, 'the educator lands on /edu').toBe('/edu');

    // --- Prerequisite: a quiz with three questions ---------------------------
    const bank = await ensureBank(page.request);
    const questions = await ensureQuestions(page.request, bank.id);
    await removeOwnAssignments(page.request);
    const quiz = await ensureQuiz(page.request, questions);
    const quizQuestionIds = questions.map((question) => question.id);

    // --- Step 0: the quiz detail shows the quiz and its questions ------------
    await page.goto(`/edu/quizzes/${quiz.id}`);
    await expect(page).toHaveURL(new RegExp(`/edu/quizzes/${quiz.id}$`));
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
    await expect(page.locator('h1')).toHaveText(QUIZ.name);
    for (const content of QUESTION_CONTENTS) {
      await expect(
        page.locator('[data-slot="card"]').filter({ hasText: content }),
        `the quiz lists „${content}”`,
      ).toBeVisible();
    }

    // --- Step 1: „Utwórz kartkówkę” opens the pre-loaded form ----------------
    const trigger = page.getByRole('link', { name: COPY.createAssignment });
    await expect(trigger, 'the quiz offers „Utwórz kartkówkę”').toBeVisible();
    await expect(trigger).toHaveAttribute('href', `/edu/assignments/new?quizId=${quiz.id}`);
    await trigger.click();

    await expect(page).toHaveURL(new RegExp(`/edu/assignments/new\\?quizId=${quiz.id}$`));
    await expect(page.locator('h1')).toHaveText(COPY.newTitle);
    await expect(page.getByText(COPY.newSubtitle, { exact: true })).toBeVisible();

    // --- Expected result: the form arrives with the quiz already loaded ------
    await expect(page.locator('#title'), 'the title is pre-filled with the quiz name').toHaveValue(
      QUIZ.name,
    );
    await expect(
      page.getByText(COPY.basedOn, { exact: true }),
      'the form names the quiz it is based on',
    ).toBeVisible();

    // Nothing else has to be typed: the prefilled title already enables the submit.
    const submit = page.locator('form button[type="submit"]');
    await expect(submit).toHaveText(COPY.createAssignment);
    await expect(submit, 'the pre-filled title enables the create button').toBeEnabled();
    await submit.click();

    await page.waitForURL(ASSIGNMENT_ID);
    const assignmentId = page.url().match(ASSIGNMENT_ID)![1];

    // --- Expected result: the draft carries the quiz's questions -------------
    await expect(page.locator('h1'), 'the assignment is titled after the quiz').toHaveText(
      QUIZ.name,
    );
    await expect(page.getByText(COPY.draft, { exact: true })).toBeVisible();
    await expectCounter(page, 'Pytania', QUESTION_CONTENTS.length);
    await expectCounter(page, 'Suma punktów', QUESTION_CONTENTS.length * POINTS_PER_QUESTION);

    const sourceLink = page.getByRole('link', { name: COPY.sourceQuiz });
    await expect(sourceLink, 'the draft links back to its source quiz').toHaveAttribute(
      'href',
      `/edu/quizzes/${quiz.id}`,
    );

    // The questions are listed in the quiz's order, each with its type badge and points.
    const listCard = questionListCard(page);
    await expect(listCard, 'the copied questions are listed').toHaveCount(1);
    await expect(
      listCard.locator('[data-slot="badge"]'),
      'one type badge per copied question',
    ).toHaveCount(QUESTION_CONTENTS.length);
    const listText = await listCard.innerText();
    const positions = QUESTION_CONTENTS.map((content) => listText.indexOf(content));
    for (const [index, position] of positions.entries()) {
      expect(position, `„${QUESTION_CONTENTS[index]}” is listed`).toBeGreaterThanOrEqual(0);
    }
    expect(positions, 'the questions keep the quiz order').toEqual(
      [...positions].sort((a, b) => a - b),
    );

    // The API confirms the questions were copied, not merely linked.
    const assignment = await readAssignment(page.request, assignmentId);
    expect(assignment.title).toBe(QUIZ.name);
    expect(assignment.quiz_id, 'the assignment remembers its source quiz').toBe(quiz.id);
    expect(assignment.question_count).toBe(QUESTION_CONTENTS.length);
    expect(assignment.total_points).toBe(QUESTION_CONTENTS.length * POINTS_PER_QUESTION);
    const copied = [...assignment.assignment_questions].sort(
      (a, b) => a.order_index - b.order_index,
    );
    expect(
      copied.map((row) => row.question_id),
      'the assignment holds the quiz questions in order',
    ).toEqual(quizQuestionIds);
    expect(
      copied.map((row) => row.points),
      'every copied question keeps its points',
    ).toEqual(quizQuestionIds.map(() => POINTS_PER_QUESTION));
    expect(
      copied.map((row) => row.question?.content),
      'the copied rows resolve to the quiz questions',
    ).toEqual([...QUESTION_CONTENTS]);

    // --- Adjacent regression: the source link leads back to the quiz ---------
    await sourceLink.click();
    await expect(page).toHaveURL(new RegExp(`/edu/quizzes/${quiz.id}$`));
    await expect(page.locator('h1')).toHaveText(QUIZ.name);

    expect(pageErrors, 'uncaught page errors during the walk').toEqual([]);
  });
});
