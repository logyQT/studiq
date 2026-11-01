import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

/**
 * STU-35 — solving a quiz from „Rozpocznij kartkówkę” to „Wyślij”.
 *
 * Case steps: start the quiz, answer the closed questions, type the open answer,
 * attach a photo with „Prześlij zdjęcie”, navigate with „Poprzednie”/„Następne”
 * and submit with „Wyślij”. Expected: the start creates an attempt
 * (`/app/assignments/<id>/take?attemptId=…`), answers survive navigation, the
 * photo uploads (the button shows „Przesyłanie...”) and a thumbnail appears, and
 * the submission lands on the summary / the list marked „Ukończono”.
 *
 * Tenant (deterministic, `content` profile, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts STU-35 --fresh
 *
 * gives the org `qa-stu-35-<suffix>` with a manager, an educator and the student
 * this case signs in as — every id derived from
 * `tenantKey('qa/cases/STU-35.md', 'STU-35#<suffix>', 'qa-shared')`. The case's
 * legacy account (`student-classroom@dev.local`) is never used. Nothing global is
 * read or written: no admin setting, feature flag, plan, platform stat or
 * singleton row.
 *
 * The prerequisite („Oczekująca kartkówka z pytaniami MCQ, P/F i otwartym”) is
 * built through the product API inside this tenant by the educator: one personal
 * bank with the three question types, one assignment with `showResults` on,
 * targeted at the tenant student and published. The bank and questions are
 * found-or-created so CI retries on the same seeded tenant reuse them (the
 * educator's plan caps question banks); every run creates a new assignment with a
 * per-run title because a student may start only one attempt per assignment.
 *
 * The walk on the shared app (:3010, Polish UI, worker qa-env-4) confirmed:
 * - „Rozpocznij kartkówkę” posts `/start` and redirects to the take page with the
 *   new attempt id; question/option order is shuffled, so every step below
 *   addresses a question by its content.
 * - „Następne” → „Poprzednie” keeps the selected radio and the typed open answer.
 * - The open question has the placeholder „Wpisz swoją odpowiedź...”, the button
 *   „Prześlij zdjęcie”, the in-flight label „Przesyłanie...”, the toast
 *   „Dodano zdjęcie: <name>” and the thumbnail under „Dodane zdjęcia”.
 * - „Wyślij” submits and returns to `/app/assignments/<id>`, which shows
 *   „Ukończono” and (results on) „Wynik: 2/3” + „Zobacz podsumowanie”; the list
 *   then shows the quiz under „UKOŃCZONE (n)” with „2/3” and „Ukończono: <date>”.
 * - API: the completed attempt returns the three saved answers (two selected
 *   options and the open text), and `GET /api/v1/assignments` reports
 *   `attempts_used: 1` with the completed attempt.
 */

const CASE = 'STU-35';

const BANKS_URL = '/api/v1/questions/banks';
const QUESTIONS_URL = '/api/v1/questions';
const ASSIGNMENTS_URL = '/api/v1/teacher/assignments';
const STUDENT_ASSIGNMENTS_URL = '/api/v1/assignments';

/** Polish copy from `AppAssignmentTakePage` / `AppAssignmentDetailPage` (pl.json). */
const COPY = {
  start: 'Rozpocznij kartkówkę',
  previous: 'Poprzednie',
  next: 'Następne',
  submit: 'Wyślij',
  uploading: 'Przesyłanie...',
  uploadPhoto: 'Prześlij zdjęcie',
  answerPlaceholder: 'Wpisz swoją odpowiedź...',
  attachedPhotos: 'Dodane zdjęcia',
  completed: 'Ukończono',
  review: 'Zobacz podsumowanie',
  pendingReview: 'Oczekuje na ocenę',
} as const;

/** The case rows, built in this case's own tenant. */
const BANK_NAME = 'STU-35 bank';
const ASSIGNMENT_DESCRIPTION = 'Kartkówka STU-35';
const OPEN_ANSWER = 'Układ Słoneczny ma osiem planet i Słońce w środku.';
const PHOTO_NAME = 'odpowiedz.png';
/** A valid 1×1 PNG, so the storage bucket accepts the upload. */
const PHOTO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const QUESTIONS = {
  mcq: {
    type: 'mcq',
    content: 'Która planeta jest najbliżej Słońca?',
    correct: 'Merkury',
    options: ['Merkury', 'Wenus', 'Mars'],
  },
  trueFalse: {
    type: 'true_false',
    content: 'Słońce jest gwiazdą.',
    correct: 'Prawda',
    options: ['Prawda', 'Fałsz'],
  },
  open: {
    type: 'open',
    content: 'Opisz Układ Słoneczny.',
  },
} as const;

/** Unique per run: the student gets one attempt per assignment, so a retry on the
 * same seeded tenant needs its own assignment instead of a second attempt. */
const RUN_SUFFIX =
  process.env.QA_RUN_SUFFIX ??
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface QuestionRow {
  id: string;
  content: string;
  type: string;
  question_answers?: Array<{ id: string; content: string; is_correct?: boolean }>;
}

interface BankList {
  items: Array<{ id: string; name: string }>;
}

interface AssignmentSummary {
  id: string;
  title: string;
  status: 'draft' | 'published';
  question_count: number;
}

interface AttemptData {
  id: string;
  questions: QuestionRow[];
  answers?: Record<
    string,
    { selected_answer_id: string | null; text_answer: string | null; is_correct?: boolean }
  >;
}

interface StudentAssignment {
  id: string;
  title: string;
  max_attempts: number;
  attempts_used: number;
  last_completed_attempt: { id: string; score: number | null; completed_at: string | null } | null;
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

/** The tenant's bank for this case, reused when a retry already created it. */
async function ensureBank(request: APIRequestContext): Promise<string> {
  const banks = await api<BankList>(request, 'GET', `${BANKS_URL}?limit=100`);
  const existing = banks.items.find((bank) => bank.name === BANK_NAME);
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
  spec: { type: string; content: string; correct?: string; options?: readonly string[] },
): Promise<QuestionRow> {
  const existing = await api<QuestionRow[]>(request, 'GET', `${QUESTIONS_URL}?bankId=${bankId}`);
  const found = existing.find((question) => question.content === spec.content);
  if (found) return found;

  const answers = (spec.options ?? []).map((content, index) => ({
    content,
    isCorrect: content === spec.correct,
    orderIndex: index,
  }));
  return api<QuestionRow>(request, 'POST', QUESTIONS_URL, {
    bankId,
    type: spec.type,
    content: spec.content,
    answers,
  });
}

/**
 * Build the case prerequisite in the tenant: one published assignment with the
 * MCQ, P/F and open question, targeted at the tenant student. `showResults` is
 * on so the submitted answers can be reviewed afterwards.
 */
async function prepareAssignment(
  page: Page,
  studentId: string,
): Promise<{ id: string; title: string }> {
  const request = page.request;
  const bankId = await ensureBank(request);
  const questions = [
    await ensureQuestion(request, bankId, QUESTIONS.mcq),
    await ensureQuestion(request, bankId, QUESTIONS.trueFalse),
    await ensureQuestion(request, bankId, QUESTIONS.open),
  ];

  const title = `STU-35 kartkówka ${RUN_SUFFIX}`;
  const created = await api<AssignmentSummary>(request, 'POST', ASSIGNMENTS_URL, {
    title,
    description: ASSIGNMENT_DESCRIPTION,
    showResults: true,
  });
  expect(created.status, 'a freshly created assignment is a draft').toBe('draft');

  await api(request, 'POST', `${ASSIGNMENTS_URL}/${created.id}/questions`, {
    questionIds: questions.map((question) => question.id),
  });
  await api(request, 'PUT', `${ASSIGNMENTS_URL}/${created.id}/targets`, {
    studentIds: [studentId],
  });
  await api(request, 'POST', `${ASSIGNMENTS_URL}/${created.id}/publish`, {});

  const detail = await api<AssignmentSummary>(request, 'GET', `${ASSIGNMENTS_URL}/${created.id}`);
  expect(detail.status, 'the prerequisite quiz is published').toBe('published');
  expect(detail.question_count, 'the quiz carries all three questions').toBe(3);
  return { id: created.id, title };
}

function getAttempt(page: Page, attemptId: string): Promise<AttemptData> {
  return api<AttemptData>(page.request, 'GET', `/api/v1/quiz/${attemptId}`);
}

function getStudentAssignment(page: Page, assignmentId: string): Promise<StudentAssignment> {
  return api<StudentAssignment[]>(page.request, 'GET', STUDENT_ASSIGNMENTS_URL).then(
    (assignments) => {
      const found = assignments.find((assignment) => assignment.id === assignmentId);
      if (!found) throw new Error(`assignment ${assignmentId} is not in the student list`);
      return found;
    },
  );
}

function toast(page: Page, text: string): Locator {
  return page.locator('[data-sonner-toast]').filter({ hasText: text }).last();
}

/** The question card's content line — the only `text-lg` paragraph on the take page. */
function questionContent(page: Page): Locator {
  return page.locator('main p.text-lg.font-medium');
}

/** The radio row that owns an option label. */
function optionRow(page: Page, label: string): Locator {
  return page
    .locator('main div.flex.items-center.gap-3')
    .filter({ has: page.getByText(label, { exact: true }) });
}

async function selectOption(page: Page, label: string): Promise<void> {
  const row = optionRow(page, label);
  await expect(row, `the “${label}” option is rendered`).toHaveCount(1);
  await row.locator('[data-slot="label"]').click();
  await expect(row.locator('[role="radio"]'), `“${label}” is selected`).toHaveAttribute(
    'aria-checked',
    'true',
  );
}

/**
 * Type the open answer and attach one photo, asserting the in-flight label, the
 * upload response, the success toast and the thumbnail. The upload request is
 * delayed so the transient „Przesyłanie...” state is observable deterministically.
 */
async function answerOpenQuestion(page: Page): Promise<void> {
  const textarea = page.locator(`main textarea[placeholder="${COPY.answerPlaceholder}"]`);
  await expect(
    textarea,
    'the open question offers the „Wpisz swoją odpowiedź...” field',
  ).toBeVisible();
  await textarea.fill(OPEN_ANSWER);

  const uploadPattern = '**/api/v1/assignments/**/upload-image';
  await page.route(uploadPattern, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    await route.continue();
  });

  const uploadResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/api\/v1\/assignments\/[^/]+\/upload-image$/.test(new URL(response.url()).pathname),
  );

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: COPY.uploadPhoto, exact: true }).click(),
  ]);
  await chooser.setFiles({ name: PHOTO_NAME, mimeType: 'image/png', buffer: PHOTO });

  await expect(
    page.getByRole('button', { name: COPY.uploading, exact: true }),
    'the button reports the in-flight upload',
  ).toBeVisible();

  const uploaded = await uploadResponse;
  expect(uploaded.status(), 'POST …/upload-image').toBe(200);
  const body = (await uploaded.json()) as ApiEnvelope<{ imageUrl?: string }>;
  expect(body.success, 'the upload succeeds').toBe(true);
  expect(body.data.imageUrl, 'the image lands in the assignment bucket').toContain(
    'assignment-images',
  );
  await page.unroute(uploadPattern);

  await expect(
    toast(page, `Dodano zdjęcie: ${PHOTO_NAME}`),
    'the „Dodano zdjęcie” toast',
  ).toBeVisible();
  await expect(
    page.locator(`main img[alt="${PHOTO_NAME}"]`),
    'the uploaded photo renders as a thumbnail',
  ).toBeVisible();
  await expect(
    page.locator(`main ul[aria-label="${COPY.attachedPhotos}"] li`),
    'exactly one photo is attached',
  ).toHaveCount(1);
}

/** Assert that a question whose answer was already given still shows it. */
async function expectAnswerKept(page: Page, content: string): Promise<void> {
  if (content === QUESTIONS.mcq.content) {
    await expect(
      optionRow(page, QUESTIONS.mcq.correct).locator('[role="radio"]'),
      'the multiple-choice answer survives navigation',
    ).toHaveAttribute('aria-checked', 'true');
  } else if (content === QUESTIONS.trueFalse.content) {
    await expect(
      optionRow(page, QUESTIONS.trueFalse.correct).locator('[role="radio"]'),
      'the true/false answer survives navigation',
    ).toHaveAttribute('aria-checked', 'true');
  } else {
    await expect(
      page.locator(`main textarea[placeholder="${COPY.answerPlaceholder}"]`),
      'the open answer survives navigation',
    ).toHaveValue(OPEN_ANSWER);
    await expect(
      page.locator(`main img[alt="${PHOTO_NAME}"]`),
      'the attached photo still renders',
    ).toBeVisible();
  }
}

test.describe('@case:STU-35 @area:STU @prio:P1 solve a quiz end to end', () => {
  test('starts an attempt, keeps answers, uploads a photo and submits', async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(180_000);

    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    const student = tenant.users.student;
    if (!tenant.org || !student) {
      throw new Error(`${CASE} needs the content tenant profile (org, group and student)`);
    }

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // --- Prerequisite: a published quiz with MCQ, P/F and open questions ----
    const teacherContext = await browser.newContext({ baseURL });
    let assignment: { id: string; title: string };
    try {
      const teacherPage = await teacherContext.newPage();
      await loginAs(teacherPage, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu(\/|$)/ });
      assignment = await prepareAssignment(teacherPage, student.id);
    } finally {
      await teacherContext.close();
    }

    // --- The student's own surface ------------------------------------------
    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
    await page.goto('/app/assignments');
    await expect(page).toHaveURL(/\/app\/assignments$/);

    const card = page.locator(`main a[href="/app/assignments/${assignment.id}"]`);
    await expect(card, 'the published quiz is listed').toBeVisible();
    await expect(card).toContainText(assignment.title);
    await expect(card).toContainText('3 pytania');
    await expect(card).toContainText('3 punkty');

    // --- Step 1: „Rozpocznij kartkówkę” creates the attempt ------------------
    await card.click();
    await expect(page).toHaveURL(new RegExp(`/app/assignments/${assignment.id}$`));
    await expect(
      page.getByRole('heading', { level: 1, name: assignment.title, exact: true }),
    ).toBeVisible();
    await expect(page.getByText(ASSIGNMENT_DESCRIPTION, { exact: true })).toBeVisible();

    const startResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/api/v1/assignments/${assignment.id}/start`),
    );
    await page.getByRole('button', { name: COPY.start, exact: true }).click();
    const started = await startResponse;
    expect(started.status(), `POST …/${assignment.id}/start`).toBe(200);
    const startedBody = (await started.json()) as ApiEnvelope<{ id: string }>;

    await expect(page, 'the start opens the take page with the new attempt id').toHaveURL(
      new RegExp(`/app/assignments/${assignment.id}/take\\?attemptId=[0-9a-f-]{36}$`),
    );
    const attemptId = new URL(page.url()).searchParams.get('attemptId') ?? '';
    expect(attemptId, 'the URL carries an attempt id').toMatch(/^[0-9a-f-]{36}$/);
    expect(startedBody.data.id, 'the start response returns the same attempt').toBe(attemptId);
    await expect(page.getByText('Rozwiązywanie kartkówki', { exact: true })).toBeVisible();

    // --- Steps 2 + 4: answer each question, navigating back and forth -------
    const seen = new Set<string>();
    for (let index = 0; index < 3; index += 1) {
      await expect(
        page.getByText(`${index + 1} / 3`, { exact: true }),
        `the take page shows question ${index + 1} of 3`,
      ).toBeVisible();

      const content = (await questionContent(page).innerText()).trim();
      seen.add(content);

      if (content === QUESTIONS.mcq.content) {
        await selectOption(page, QUESTIONS.mcq.correct);
      } else if (content === QUESTIONS.trueFalse.content) {
        await selectOption(page, QUESTIONS.trueFalse.correct);
      } else {
        expect(content, 'the third question is the open one').toBe(QUESTIONS.open.content);
        // Step 3: „Prześlij zdjęcie” on the open question.
        await answerOpenQuestion(page);
      }

      if (index === 2) break;

      // „Następne” → „Poprzednie” keeps the answer already given.
      await page.getByRole('button', { name: COPY.next, exact: true }).click();
      await expect(page.getByText(`${index + 2} / 3`, { exact: true })).toBeVisible();
      await page.getByRole('button', { name: COPY.previous, exact: true }).click();
      await expect(page.getByText(`${index + 1} / 3`, { exact: true })).toBeVisible();
      await expectAnswerKept(page, content);
      await page.getByRole('button', { name: COPY.next, exact: true }).click();
      await expect(page.getByText(`${index + 2} / 3`, { exact: true })).toBeVisible();
    }
    expect(seen.size, 'all three questions were answered').toBe(3);
    await expect(
      page.getByRole('button', { name: COPY.next, exact: true }),
      'the last question has no „Następne”',
    ).toHaveCount(0);

    // The option ids the attempt exposes before submission, for the saved-answer checks.
    const before = await getAttempt(page, attemptId);
    const questionByContent = new Map(
      before.questions.map((question) => [question.content, question]),
    );
    const mcqQuestion = questionByContent.get(QUESTIONS.mcq.content);
    const trueFalseQuestion = questionByContent.get(QUESTIONS.trueFalse.content);
    const openQuestion = questionByContent.get(QUESTIONS.open.content);
    if (!mcqQuestion || !trueFalseQuestion || !openQuestion) {
      throw new Error('the attempt does not expose all three questions');
    }
    const correctOptionId = (question: QuestionRow, label: string): string => {
      const option = question.question_answers?.find((answer) => answer.content === label);
      if (!option) throw new Error(`question “${question.content}” has no “${label}” option`);
      return option.id;
    };
    const mcqOptionId = correctOptionId(mcqQuestion, QUESTIONS.mcq.correct);
    const trueFalseOptionId = correctOptionId(trueFalseQuestion, QUESTIONS.trueFalse.correct);

    // --- Step 4 (end): „Wyślij” ---------------------------------------------
    const submitResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/api/v1/quiz/${attemptId}`),
    );
    await page.getByRole('button', { name: COPY.submit, exact: true }).click();
    const submitted = await submitResponse;
    expect(submitted.status(), `POST /api/v1/quiz/${attemptId}`).toBe(200);

    // Expected: the submission lands on the summary/detail marked „Ukończono”.
    await expect(page).toHaveURL(new RegExp(`/app/assignments/${assignment.id}$`));
    await expect(
      page.getByRole('heading', { level: 1, name: assignment.title, exact: true }),
    ).toBeVisible();
    await expect(page.getByText(COPY.completed, { exact: true })).toBeVisible();
    await expect(
      page.getByText('Wynik: 2/3', { exact: true }),
      'the two closed questions are auto-graded',
    ).toBeVisible();
    await expect(page.getByRole('link', { name: COPY.review, exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: COPY.start, exact: true }),
      'a single-attempt quiz cannot be started again',
    ).toHaveCount(0);

    // --- Expected result, server side ---------------------------------------
    const completedAssignment = await getStudentAssignment(page, assignment.id);
    expect(completedAssignment.max_attempts, 'the quiz allows one attempt').toBe(1);
    expect(completedAssignment.attempts_used, 'the attempt is counted as used').toBe(1);
    expect(completedAssignment.last_completed_attempt?.id, 'the attempt is completed').toBe(
      attemptId,
    );
    expect(completedAssignment.last_completed_attempt?.completed_at).toBeTruthy();
    expect(completedAssignment.last_completed_attempt?.score, 'two points are auto-graded').toBe(2);

    const review = await getAttempt(page, attemptId);
    expect(review.answers?.[mcqQuestion.id]?.selected_answer_id, 'the MCQ answer is saved').toBe(
      mcqOptionId,
    );
    expect(review.answers?.[mcqQuestion.id]?.is_correct, 'the MCQ answer is correct').toBe(true);
    expect(
      review.answers?.[trueFalseQuestion.id]?.selected_answer_id,
      'the true/false answer is saved',
    ).toBe(trueFalseOptionId);
    expect(review.answers?.[trueFalseQuestion.id]?.is_correct, 'the P/F answer is correct').toBe(
      true,
    );
    expect(review.answers?.[openQuestion.id]?.text_answer, 'the open answer is saved').toBe(
      OPEN_ANSWER,
    );
    expect(
      review.answers?.[openQuestion.id]?.selected_answer_id,
      'the open answer carries no option id',
    ).toBeNull();

    // --- Adjacent path: the review page shows the submitted answers ----------
    await page.getByRole('link', { name: COPY.review, exact: true }).click();
    await expect(page).toHaveURL(
      new RegExp(`/app/assignments/${assignment.id}/review\\?attemptId=${attemptId}$`),
    );
    await expect(page.getByRole('heading', { level: 1, name: '2 / 3' })).toBeVisible();
    await expect(page.getByText(OPEN_ANSWER, { exact: true })).toBeVisible();
    await expect(page.getByText(COPY.pendingReview, { exact: true })).toBeVisible();

    // --- The list marks the quiz as „Ukończone” ------------------------------
    await page.goto('/app/assignments');
    const completedSection = page
      .locator('main section')
      .filter({ has: page.getByRole('heading', { name: /ukończone/i }) });
    const completedCard = completedSection.locator(`a[href="/app/assignments/${assignment.id}"]`);
    await expect(completedCard, 'the quiz is listed under „Ukończone”').toBeVisible();
    await expect(completedCard).toContainText(assignment.title);
    await expect(completedCard).toContainText('2/3');
    // `toLocaleDateString('pl')` drops the leading zero on single-digit days
    // and months (e.g. „Ukończono: 1.11.2026”), so allow one or two digits.
    await expect(completedCard).toContainText(/Ukończono: \d{1,2}\.\d{1,2}\.\d{4}/);
    await expect(
      page
        .locator('main section')
        .filter({ has: page.getByRole('heading', { name: /oczekujące/i }) })
        .locator(`a[href="/app/assignments/${assignment.id}"]`),
      'the completed quiz is no longer pending',
    ).toHaveCount(0);

    expect(pageErrors, 'the quiz walk raises no uncaught errors').toEqual([]);
  });
});
