import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * EDU-ASG-08 — grading a student's submission, per student (`/edu/assignments/:id/results/:studentId`).
 *
 * Case steps: „Oceń” next to a student in the results table, grade the open
 * question (points + feedback, „Zapisz ocenę”), then try points above the maximum
 * and a negative value.
 *
 * Prerequisite (reconciled with the tenant seeder): a submitted attempt that holds
 * an open question. The legacy accounts (`teacher-classroom@dev.local`,
 * `student-classroom@dev.local`, password `pass`) are never used.
 *
 *   bun scripts/qa-tenant.ts EDU-ASG-08 --fresh
 *
 * Tenant: the case's own `content` tenant (`__tests__/qa/profiles/EDU-ASG-08.json`) —
 * organization `qa-edu-asg-08-<suffix>`, a manager, the teacher and the student,
 * plus the default group `G1`. All ids derive from
 * `tenantKey('qa/cases/EDU-ASG-08.md', 'EDU-ASG-08#<suffix>', 'qa-shared')`; the
 * spec owns its bank, questions, assignment, attempt and image, so nothing global
 * (admin setting, feature flag, plan, platform stat, singleton row) and no other
 * tenant is touched. Re-running against the same tenant stays green: every run
 * creates its own tagged assignment, so the results table always holds exactly
 * one row for it.
 *
 * Acceptance points (walked on the shared app, Polish UI):
 * 1. The results table lists the submitted attempt with „X/Y”, status „Przesłane”
 *    and an „Oceń” link per student.
 * 2. „Oceń ucznia” shows „Wynik: X/Y”, the closed answers labelled
 *    „Poprawna” / „Niepoprawna” with the chosen and the correct answer **text**
 *    (not their UUID, and not the explanation in place of the answer), the open
 *    answer text and „Zobacz przesłane zdjęcie” for the uploaded photo.
 * 3. The open question offers „Punkty (0–1)” — `assignment_questions.points`
 *    defaults to 1 and no endpoint changes it, so 1 is this case's maximum.
 *    Points above it are rejected: inline „Punkty nie mogą przekraczać 1” and a
 *    disabled „Zapisz ocenę”; a negative value is rejected the same way (disabled
 *    button, no request). The server refuses both as well (422).
 * 4. „Zapisz ocenę” with valid points + feedback marks the attempt „(ocenione)”,
 *    keeps the inputs, and the results table row flips to „Ocenione” with the
 *    updated score.
 */

const CASE = 'EDU-ASG-08';

/** Polish copy the case quotes, as rendered by the current product. */
const COPY = {
  gradingTitle: 'Oceń ucznia',
  backToResults: 'Powrót do wyników',
  graded: 'Ocenione',
  submitted: 'Przesłane',
  grade: 'Oceń',
  correct: 'Poprawna',
  incorrect: 'Niepoprawna',
  selectedAnswer: 'Wybrana odpowiedź:',
  correctAnswer: 'Poprawna odpowiedź:',
  studentAnswer: 'Odpowiedź ucznia:',
  viewImage: 'Zobacz przesłane zdjęcie',
  pointsLabel: 'Punkty (0–1)',
  pointsTooBig: 'Punkty nie mogą przekraczać 1',
  feedbackLabel: 'Informacja zwrotna',
  save: 'Zapisz ocenę',
} as const;

/** 1×1 PNG — the smallest file the image bucket accepts (signature-sniffed). */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface CreatedQuestion {
  id: string;
  question_answers: Array<{ id: string; content: string; is_correct: boolean }>;
}

interface AssignmentDetail {
  id: string;
  title: string;
  status: 'draft' | 'published';
  question_count: number;
  total_points: number;
}

interface StudentAnswersPayload {
  score: number;
  total_points: number | null;
  graded_at: string | null;
  quiz_answers: Array<{
    question_id: string;
    text_answer: string | null;
    teacher_points: number | null;
    teacher_feedback: string | null;
  }>;
  assignment_answer_images: Array<{ question_id: string; image_url: string }>;
}

async function postJson<T>(
  page: Page,
  url: string,
  data: unknown,
): Promise<{ status: number; body: ApiEnvelope<T> }> {
  const response = await page.request.post(url, { data });
  const body = (await response.json()) as ApiEnvelope<T>;
  return { status: response.status(), body };
}

async function putJson<T>(
  page: Page,
  url: string,
  data: unknown,
): Promise<{ status: number; body: ApiEnvelope<T> | { success: false; error: string } }> {
  const response = await page.request.put(url, { data });
  const body = (await response.json()) as ApiEnvelope<T>;
  return { status: response.status(), body };
}

async function getData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.ok(), `GET ${url} → ${response.status()} ${await response.text()}`).toBe(true);
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data;
}

/** A question bank of this tenant, created once per run. */
async function createBank(page: Page, runTag: string): Promise<string> {
  const created = await postJson<{ id: string }>(page, '/api/v1/questions/banks', {
    name: `EDU-ASG-08 bank ${runTag}`,
  });
  expect(created.status, 'POST /api/v1/questions/banks').toBe(201);
  return created.body.data.id;
}

async function createClosedQuestion(
  page: Page,
  bankId: string,
  content: string,
  correctContent: string,
  wrongContent: string,
): Promise<CreatedQuestion> {
  const created = await postJson<CreatedQuestion>(page, '/api/v1/questions', {
    bankId,
    type: 'mcq',
    content,
    answers: [
      { content: correctContent, isCorrect: true, orderIndex: 0 },
      { content: wrongContent, isCorrect: false, orderIndex: 1 },
    ],
  });
  expect(created.status, `POST /api/v1/questions (${content})`).toBe(201);
  return created.body.data;
}

async function createOpenQuestion(
  page: Page,
  bankId: string,
  content: string,
): Promise<CreatedQuestion> {
  const created = await postJson<CreatedQuestion>(page, '/api/v1/questions', {
    bankId,
    type: 'open',
    content,
  });
  expect(created.status, `POST /api/v1/questions (${content})`).toBe(201);
  return created.body.data;
}

/** The case's „przesłana próba”: a published assignment targeted at the tenant group. */
async function publishAssignment(
  page: Page,
  title: string,
  questionIds: string[],
  groupId: string,
): Promise<AssignmentDetail> {
  const created = await postJson<AssignmentDetail>(page, '/api/v1/teacher/assignments', {
    title,
    shuffleQuestions: false,
    shuffleAnswers: false,
  });
  expect(created.status, `POST /api/v1/teacher/assignments (${title})`).toBe(201);

  const id = created.body.data.id;
  const added = await postJson<{ added: number }>(
    page,
    `/api/v1/teacher/assignments/${id}/questions`,
    { questionIds },
  );
  expect(added.status, `POST /api/v1/teacher/assignments/${id}/questions`).toBe(200);
  expect(added.body.data.added, 'the assignment holds its questions').toBe(questionIds.length);

  const targets = await putJson<null>(page, `/api/v1/teacher/assignments/${id}/targets`, {
    groupIds: [groupId],
  });
  expect(targets.status, `PUT /api/v1/teacher/assignments/${id}/targets`).toBe(200);

  const published = await postJson<AssignmentDetail>(
    page,
    `/api/v1/teacher/assignments/${id}/publish`,
    {},
  );
  expect(published.status, `POST /api/v1/teacher/assignments/${id}/publish`).toBe(200);
  expect(published.body.data.status, 'the assignment is published').toBe('published');

  const detail = await getData<AssignmentDetail>(page, `/api/v1/teacher/assignments/${id}`);
  expect(detail.status, 'stored status').toBe('published');
  expect(detail.total_points, 'one point per question').toBe(questionIds.length);
  return detail;
}

/**
 * The page content. The dashboard shell nests the routed page in a second
 * `<main>`, so the last one is the page under test.
 */
function content(page: Page): Locator {
  return page.locator('main').last();
}

/** One row of the results table, addressed by the student's e-mail. */
function resultRow(page: Page, email: string): Locator {
  return content(page).locator('tbody tr').filter({ hasText: email });
}

/** The grading card of one question, addressed by its content. */
function questionCard(page: Page, questionContent: string): Locator {
  return content(page).locator('div.rounded-lg.border').filter({ hasText: questionContent });
}

test.describe('@case:EDU-ASG-08 @area:EDU @prio:P1 assignment grading', () => {
  test('a teacher grades an open answer within its bound and the results table follows', async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const tenant: QaTenant = loadTenant(CASE);
    const teacher = tenant.users.teacher;
    const student = tenant.users.student;
    expect(teacher, 'the tenant seeds the teacher').toBeTruthy();
    expect(student, 'the tenant seeds the student').toBeTruthy();
    expect(tenant.group?.id, 'the tenant has the group the case targets').toBeTruthy();

    // A per-execution tag keeps repeated runs against the same tenant apart.
    const runTag = `${tenant.runSuffix ?? 'stable'}-${Date.now().toString(36)}`;
    const assignmentTitle = `EDU-ASG-08 kartkówka ${runTag}`;
    const closedCorrectContent = `EDU-ASG-08 zamknięte poprawne ${runTag}`;
    const closedWrongContent = `EDU-ASG-08 zamknięte błędne ${runTag}`;
    const openContent = `EDU-ASG-08 otwarte ${runTag}`;
    const openAnswerText = `Odpowiedź ucznia na pytanie otwarte ${runTag}`;
    const feedbackText = `Dobra odpowiedź, uzasadnienie trafne ${runTag}`;

    // ── Teacher: the prerequisite attempt's assignment ───────────────────────
    await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu/ });
    expect(new URL(page.url()).pathname, 'the educator lands on /edu').toBe('/edu');

    const bankId = await createBank(page, runTag);
    const closedCorrect = await createClosedQuestion(
      page,
      bankId,
      closedCorrectContent,
      'Odpowiedź poprawna',
      'Odpowiedź błędna',
    );
    const closedWrong = await createClosedQuestion(
      page,
      bankId,
      closedWrongContent,
      'Odpowiedź poprawna',
      'Odpowiedź błędna',
    );
    const openQuestion = await createOpenQuestion(page, bankId, openContent);

    const assignment = await publishAssignment(
      page,
      assignmentTitle,
      [closedCorrect.id, closedWrong.id, openQuestion.id],
      tenant.group!.id,
    );

    const correctOptionId = closedCorrect.question_answers.find((a) => a.is_correct)!.id;
    const wrongOptionId = closedWrong.question_answers.find((a) => !a.is_correct)!.id;

    // ── Student: submits the attempt, with a photo on the open question ──────
    const studentContext = await browser.newContext({ baseURL });
    let uploadedImageUrl: string;
    try {
      const studentPage = await studentContext.newPage();
      const studentErrors: string[] = [];
      studentPage.on('pageerror', (error) => studentErrors.push(error.message));

      await loginAs(studentPage, tenant, 'student', { locale: 'pl', waitFor: /\/app/ });

      const started = await studentPage.request.post(`/api/v1/assignments/${assignment.id}/start`);
      expect(started.status(), 'POST /api/v1/assignments/:id/start').toBe(200);
      const attemptId = ((await started.json()) as ApiEnvelope<{ id: string }>).data.id;

      const uploaded = await studentPage.request.post(
        `/api/v1/assignments/${assignment.id}/upload-image`,
        {
          multipart: {
            file: { name: 'rozwiazanie.png', mimeType: 'image/png', buffer: PNG },
            attemptId,
            questionId: openQuestion.id,
          },
        },
      );
      expect(uploaded.status(), 'POST /api/v1/assignments/:id/upload-image').toBe(200);
      uploadedImageUrl = ((await uploaded.json()) as ApiEnvelope<{ imageUrl: string }>).data
        .imageUrl;
      expect(uploadedImageUrl, 'the uploaded photo has a public URL').toContain(
        'assignment-images',
      );

      const submitted = await studentPage.request.post(`/api/v1/quiz/${attemptId}`, {
        data: {
          attemptId,
          answers: [
            { questionId: closedCorrect.id, selectedAnswerId: correctOptionId },
            { questionId: closedWrong.id, selectedAnswerId: wrongOptionId },
            { questionId: openQuestion.id, textAnswer: openAnswerText },
          ],
        },
      });
      expect(submitted.status(), `POST /api/v1/quiz/${attemptId}`).toBe(200);

      expect(studentErrors, 'uncaught page errors in the student session').toEqual([]);
    } finally {
      await studentContext.close();
    }

    // ── Step 1: the results table offers „Oceń” for the submitted attempt ────
    await page.goto(`/edu/assignments/${assignment.id}/results`);
    await expect(page).toHaveURL(new RegExp(`/edu/assignments/${assignment.id}/results$`));

    const row = resultRow(page, student!.email);
    await expect(row, 'the submitted attempt is listed').toBeVisible();
    // One point for the correctly answered closed question, three in total.
    await expect(row.locator('td').nth(2), 'the score before grading').toHaveText('1/3');
    await expect(row.getByText(COPY.submitted, { exact: true })).toBeVisible();
    await expect(row.getByText(COPY.graded, { exact: true })).toHaveCount(0);

    await row.getByRole('link', { name: COPY.grade, exact: true }).click();
    await expect(page).toHaveURL(
      new RegExp(`/edu/assignments/${assignment.id}/results/${student!.id}$`),
    );

    // ── Step 2: „Oceń ucznia” shows the answers and the uploaded photo ───────
    await expect(page.getByRole('heading', { name: COPY.gradingTitle })).toBeVisible();
    await expect(content(page).getByText('Wynik: 1/3', { exact: true })).toBeVisible();

    // Closed question answered correctly: „Poprawna” + the answer *texts*.
    const correctCard = questionCard(page, closedCorrectContent);
    await expect(correctCard).toHaveCount(1);
    await expect(correctCard.getByText(COPY.correct, { exact: true })).toBeVisible();
    await expect(correctCard.getByText(COPY.incorrect, { exact: true })).toHaveCount(0);
    await expect(
      correctCard.getByText(`${COPY.selectedAnswer} Odpowiedź poprawna`, { exact: true }),
    ).toBeVisible();
    await expect(
      correctCard.getByText(`${COPY.correctAnswer} Odpowiedź poprawna`, { exact: true }),
    ).toBeVisible();
    // The case's UX note: the page must not print the option id instead of its text.
    await expect(content(page), 'no raw answer UUID on the grading page').not.toContainText(
      correctOptionId,
    );

    // Closed question answered incorrectly: „Niepoprawna” + chosen vs correct text.
    const wrongCard = questionCard(page, closedWrongContent);
    await expect(wrongCard).toHaveCount(1);
    await expect(wrongCard.getByText(COPY.incorrect, { exact: true })).toBeVisible();
    await expect(wrongCard.getByText(COPY.correct, { exact: true })).toHaveCount(0);
    await expect(
      wrongCard.getByText(`${COPY.selectedAnswer} Odpowiedź błędna`, { exact: true }),
    ).toBeVisible();
    await expect(
      wrongCard.getByText(`${COPY.correctAnswer} Odpowiedź poprawna`, { exact: true }),
    ).toBeVisible();

    // Open question: the student's text, the photo and the points bound.
    const openCard = questionCard(page, openContent);
    await expect(openCard).toHaveCount(1);
    await expect(
      openCard.getByText(`${COPY.studentAnswer} ${openAnswerText}`, { exact: true }),
    ).toBeVisible();
    const imageLink = openCard.getByRole('link', { name: COPY.viewImage });
    await expect(imageLink).toBeVisible();
    await expect(imageLink).toHaveAttribute('href', uploadedImageUrl);
    await expect(openCard.getByText(COPY.pointsLabel, { exact: true })).toBeVisible();
    await expect(openCard.getByText(COPY.feedbackLabel, { exact: true })).toBeVisible();

    const pointsInput = openCard.locator('input[type="number"]');
    const feedbackInput = openCard.locator('textarea');
    const saveButton = openCard.getByRole('button', { name: COPY.save, exact: true });

    await expect(pointsInput).toHaveValue('');
    await expect(saveButton, '„Zapisz ocenę” is inactive without points').toBeDisabled();

    // ── Step 3: points outside 0…max are rejected, never sent ────────────────
    const gradingPath = `/api/v1/teacher/assignments/${assignment.id}/results/${student!.id}`;
    let gradeRequests = 0;
    page.on('request', (request) => {
      if (request.method() === 'PUT' && new URL(request.url()).pathname === gradingPath) {
        gradeRequests += 1;
      }
    });

    await pointsInput.fill('2');
    await expect(openCard.getByText(COPY.pointsTooBig, { exact: true })).toBeVisible();
    await expect(pointsInput).toHaveAttribute('aria-invalid', 'true');
    await expect(saveButton, '„Zapisz ocenę” stays inactive above the maximum').toBeDisabled();

    await pointsInput.fill('-1');
    await expect(
      openCard.getByText(COPY.pointsTooBig, { exact: true }),
      'a negative value is not an out-of-range hint, it is simply unsavable',
    ).toHaveCount(0);
    await expect(saveButton, '„Zapisz ocenę” stays inactive for a negative value').toBeDisabled();

    expect(gradeRequests, 'no grading request was sent for invalid points').toBe(0);

    // ── Step 2 (continued): a valid grade marks the attempt „(ocenione)” ─────
    await pointsInput.fill('1');
    await feedbackInput.fill(feedbackText);
    await expect(saveButton).toBeEnabled();

    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' && new URL(response.url()).pathname === gradingPath,
    );
    await saveButton.click();
    expect((await saved).status(), 'PUT the grade').toBe(200);

    await expect(
      content(page).getByText('Wynik: 2/3 (ocenione)', { exact: true }),
      'the score includes the graded open answer',
    ).toBeVisible();
    await expect(pointsInput).toHaveValue('1');
    await expect(feedbackInput).toHaveValue(feedbackText);

    // ── The results table follows: „Ocenione” and the updated score ──────────
    await page.getByRole('link', { name: COPY.backToResults }).click();
    await expect(page).toHaveURL(new RegExp(`/edu/assignments/${assignment.id}/results$`));

    const gradedRow = resultRow(page, student!.email);
    await expect(gradedRow.getByText(COPY.graded, { exact: true })).toBeVisible();
    await expect(gradedRow.getByText(COPY.submitted, { exact: true })).toHaveCount(0);
    await expect(gradedRow.locator('td').nth(2), 'the score after grading').toHaveText('2/3');

    // ── Adjacent regression: the server enforces the same bound ──────────────
    const stored = await getData<StudentAnswersPayload>(page, gradingPath);
    expect(stored.graded_at, 'the attempt is graded').not.toBeNull();
    const storedOpen = stored.quiz_answers.find((a) => a.question_id === openQuestion.id);
    expect(storedOpen?.teacher_points, 'stored points').toBe(1);
    expect(storedOpen?.teacher_feedback, 'stored feedback').toBe(feedbackText);
    expect(stored.assignment_answer_images.length, 'the photo is stored').toBe(1);

    const tooHigh = await putJson(page, gradingPath, {
      questionId: openQuestion.id,
      points: 2,
      feedback: 'poza zakresem',
    });
    expect(tooHigh.status, 'points above the question maximum are refused').toBe(422);

    const negative = await putJson(page, gradingPath, {
      questionId: openQuestion.id,
      points: -1,
      feedback: 'ujemne',
    });
    expect(negative.status, 'negative points are refused').toBe(422);

    const unchanged = await getData<StudentAnswersPayload>(page, gradingPath);
    const unchangedOpen = unchanged.quiz_answers.find((a) => a.question_id === openQuestion.id);
    expect(unchangedOpen?.teacher_points, 'a refused grade never overwrites the stored one').toBe(
      1,
    );
    expect(unchanged.score, 'the score is untouched by refused grades').toBe(2);

    expect(pageErrors, 'uncaught page errors in the teacher session').toEqual([]);
  });
});
