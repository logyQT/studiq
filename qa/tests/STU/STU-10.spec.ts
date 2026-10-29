import { expect, test, type Page, type Response } from '@playwright/test';
import { createQaSupabase } from '@qa/fixtures/qa-db';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * STU-10 — Quiz „Sprawdź się”: wznowienie niedokończonego quizu.
 *
 * Prerequisite (reconciled with the tenant seeder): a student signed in to
 * `/app` who has started a quiz and left it unfinished. The legacy manual
 * account (`student1@dev.local`, password `pass`) is never used; the case runs
 * on its own tenant, seeded by the suite runner before every independent run:
 *
 *   bun scripts/qa-tenant.ts STU-10 --fresh
 *
 * `qa/tests/profiles/STU-10.json` declares the default `content` profile: one
 * organization on its default `launch` plan (the member role grants `quiz`),
 * the tenant's manager/teacher, and the `student` account this case logs in as.
 * The profile seeds the graph only, so the „Rozpoczęty quiz” prerequisite is
 * built here, inside the same tenant: the student creates its own question bank
 * with three multiple-choice questions (`question.create` = `own`) and generates
 * a 3-question quiz through `/app/study/quiz`. Nothing shared is read or
 * written — no seed content, plan catalogue row, feature flag or other tenant.
 *
 * CI seeds that tenant once for the whole case and Playwright retries reuse it,
 * so the test first clears the student's own attempts and banks: a retry must
 * never depend on (or trip over) state the previous attempt left behind.
 *
 * Acceptance points (walked on the shared app before writing the test):
 * 1. Leaving a running quiz (back to „Sprawdź się”) shows the banner
 *    „Quiz w trakcie” / „Masz niedokończony quiz. Kontynuuj lub anuluj go.”
 *    with the „Kontynuuj” and „Anuluj” buttons.
 * 2. „Kontynuuj” reopens the *same* attempt and the answers given before leaving
 *    are still selected — they are autosaved to the attempt draft (#349), so this
 *    also covers a real unmount (the sidebar link), not just a reload.
 * 3. „Anuluj” shows the documented limitation toast „Anulowanie quizów będzie
 *    dostępne wkrótce”, keeps the attempt open and does not crash the page.
 * 4. Adjacent regression for the same banner: once the quiz is submitted the
 *    banner disappears, the attempt shows up under „Ostatnie quizy” with its
 *    score and a „Przejrzyj” link, and a deep link to the finished attempt opens
 *    the review instead of a resumable quiz.
 *
 * Polish copy is asserted because the case quotes the Polish UI; the fixture
 * pins `NEXT_LOCALE=pl` so a locale cookie from another case cannot change it.
 */

const CASE = 'STU-10';

const COPY = {
  bannerTitle: 'Quiz w trakcie',
  bannerDesc: 'Masz niedokończony quiz. Kontynuuj lub anuluj go.',
  continueQuiz: 'Kontynuuj',
  abortQuiz: 'Anuluj',
  abortComingSoon: 'Anulowanie quizów będzie dostępne wkrótce',
  mcq: 'Wielokrotny wybór',
  generate: 'Generuj quiz',
  next: 'Następne',
  submit: 'Zakończ test',
  noHistory: 'Brak historii quizów',
  recentQuizzes: 'Ostatnie quizy',
  review: 'Przejrzyj',
  reviewTitle: 'Wyniki testu',
} as const;

/** The bank the student creates for itself; ids come from the tenant's own API. */
const SEED_QUESTIONS: Array<{ content: string; answers: [string, string] }> = [
  { content: 'STU-10 Q1: ile to 2 + 2?', answers: ['cztery', 'pięć'] },
  { content: 'STU-10 Q2: stolica Polski?', answers: ['Warszawa', 'Kraków'] },
  { content: 'STU-10 Q3: ile to 3 * 3?', answers: ['dziewięć', 'sześć'] },
];

const QUESTION_COUNT = SEED_QUESTIONS.length;

interface QuestionOption {
  id: string;
  content: string;
}

interface AttemptQuestion {
  id: string;
  content: string;
  type: string;
  question_answers: QuestionOption[];
}

interface AttemptPayload {
  id: string;
  completed_at: string | null;
  total_questions: number;
  questions: AttemptQuestion[];
  answers: Record<string, { selected_answer_id: string | null; text_answer: string | null }>;
}

interface AttemptSummary {
  id: string;
  score: number | null;
  completed_at: string | null;
}

/** The seeded question behind a question the generator picked. */
function seedFor(content: string) {
  const seed = SEED_QUESTIONS.find((question) => question.content === content);
  if (!seed) throw new Error(`no seeded question matches the attempt question "${content}"`);
  return seed;
}

function answersPutFor(attemptId: string) {
  return (response: Response) =>
    response.request().method() === 'PUT' &&
    new URL(response.url()).pathname === `/api/v1/quiz/${attemptId}/answers`;
}

async function getAttempt(page: Page, attemptId: string): Promise<AttemptPayload> {
  const response = await page.request.get(`/api/v1/quiz/${attemptId}`);
  expect(response.status(), `GET /api/v1/quiz/${attemptId}`).toBe(200);
  return ((await response.json()) as { data: AttemptPayload }).data;
}

async function listAttempts(page: Page): Promise<AttemptSummary[]> {
  const response = await page.request.get('/api/v1/quiz/attempts');
  expect(response.status(), 'GET /api/v1/quiz/attempts').toBe(200);
  return ((await response.json()) as { data: AttemptSummary[] }).data;
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

/** The student's own multiple-choice bank, created through the product API. */
async function seedQuestionBank(page: Page): Promise<void> {
  const bank = await page.request.post('/api/v1/questions/banks', {
    data: { name: `${CASE} bank`, description: 'Pytania dla quizu STU-10' },
  });
  expect(bank.status(), 'POST /api/v1/questions/banks').toBe(201);
  const bankId = ((await bank.json()) as { data: { id: string } }).data.id;

  for (const question of SEED_QUESTIONS) {
    const created = await page.request.post('/api/v1/questions', {
      data: {
        bankId,
        type: 'mcq',
        content: question.content,
        answers: question.answers.map((content, index) => ({
          content,
          // The first option is the correct one, so the spec never has to read
          // the answer key from the API: the in-progress payload withholds it.
          isCorrect: index === 0,
          orderIndex: index,
        })),
      },
    });
    expect(created.status(), `POST /api/v1/questions (${question.content})`).toBe(201);
  }
}

/** Starts a fresh 3-question multiple-choice quiz from /app/study/quiz. */
async function generateQuiz(page: Page): Promise<string> {
  await page.goto('/app/study/quiz');
  await expect(page.getByText(COPY.noHistory, { exact: true })).toBeVisible();

  const mcq = page.getByRole('checkbox', { name: COPY.mcq });
  await mcq.click();
  await expect(mcq).toBeChecked();

  await page.locator('input[type="number"]').fill(String(QUESTION_COUNT));
  await page.getByRole('button', { name: COPY.generate, exact: true }).click();

  await expect(page).toHaveURL(/\/app\/study\/session\/quiz\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  return new URL(page.url()).pathname.split('/').pop()!;
}

/** Answers the visible question and waits until the draft autosave landed. */
async function answerVisibleQuestion(
  page: Page,
  attemptId: string,
  optionContent: string,
): Promise<void> {
  const saved = page.waitForResponse(answersPutFor(attemptId), { timeout: 15_000 });
  await page.getByRole('radio', { name: optionContent, exact: true }).click();
  expect((await saved).status(), 'PUT /api/v1/quiz/:id/answers').toBe(200);
}

/** The sidebar entry the case names as the way out of a running quiz. */
function sidebarQuizLink(page: Page) {
  return page.locator('[data-slot="sidebar"] a[href="/app/study/quiz"]').first();
}

/**
 * The „Quiz w trakcie” banner. The „Ostatnie quizy” card sits next to it, so the
 * locator is pinned to the one carrying the banner copy.
 */
function unfinishedQuizBanner(page: Page) {
  return page.locator('[data-slot="card"]').filter({ hasText: COPY.bannerDesc });
}

test.describe('@case:STU-10 @area:STU @prio:P2 unfinished quiz', () => {
  test('resumes the unfinished quiz with its answers and aborts without a crash', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} runs on the content profile`).toBe('content');
    expect(
      tenant.runSuffix,
      'seed with --fresh: every independent run owns a new tenant',
    ).toBeTruthy();
    const student = tenant.users.student;
    expect(student, `${CASE} seeds the student under test`).toBeTruthy();
    expect(tenant.org, 'the student under test belongs to the tenant organization').toBeTruthy();

    // ── Precondition: a student on /app with no quiz of its own yet ─────────
    // A retry reuses this tenant, so drop whatever the previous attempt left.
    await resetStudentQuizState(tenant);
    await loginAs(page, tenant, 'student', { locale: 'pl' });
    await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });

    await seedQuestionBank(page);
    await page.goto('/app/study/quiz');

    // Without a running attempt there is no banner, only the empty history.
    await expect(page.getByText(COPY.noHistory, { exact: true })).toBeVisible();
    await expect(page.getByText(COPY.bannerDesc)).toHaveCount(0);
    await expect(page.getByRole('button', { name: COPY.continueQuiz })).toHaveCount(0);

    // ── Start a quiz and answer the first two questions ────────────────────
    const attemptId = await generateQuiz(page);
    const attempt = await getAttempt(page, attemptId);
    expect(attempt.completed_at, 'the new attempt is in progress').toBeNull();
    expect(attempt.questions, 'the generated quiz uses the seeded questions').toHaveLength(
      QUESTION_COUNT,
    );

    const firstSeed = seedFor(attempt.questions[0].content);
    const secondSeed = seedFor(attempt.questions[1].content);
    const thirdSeed = seedFor(attempt.questions[2].content);

    await expect(page.getByText(`Pytanie 1 z ${QUESTION_COUNT}`, { exact: true })).toBeVisible();
    await expect(page.locator('[data-slot="card-title"]')).toHaveText(firstSeed.content);

    // A wrong option on purpose: resuming must restore the student's choice, not
    // the correct one, and the final score below is computed from these picks.
    const firstPick = firstSeed.answers[1];
    await answerVisibleQuestion(page, attemptId, firstPick);

    await page.getByRole('button', { name: COPY.next, exact: true }).click();
    await expect(page.getByText(`Pytanie 2 z ${QUESTION_COUNT}`, { exact: true })).toBeVisible();
    await expect(page.locator('[data-slot="card-title"]')).toHaveText(secondSeed.content);
    const secondPick = secondSeed.answers[0];
    await answerVisibleQuestion(page, attemptId, secondPick);

    // Both picks are autosaved to the attempt draft before leaving.
    const drafted = await getAttempt(page, attemptId);
    expect(drafted.answers[attempt.questions[0].id]?.selected_answer_id).toBe(
      attempt.questions[0].question_answers.find((option) => option.content === firstPick)!.id,
    );
    expect(drafted.answers[attempt.questions[1].id]?.selected_answer_id).toBe(
      attempt.questions[1].question_answers.find((option) => option.content === secondPick)!.id,
    );

    // ── Step 1–2: leave the quiz and read the banner ───────────────────────
    await sidebarQuizLink(page).click();
    await expect(page).toHaveURL(/\/app\/study\/quiz$/, { timeout: 20_000 });

    const banner = unfinishedQuizBanner(page);
    await expect(banner).toHaveCount(1);
    await expect(banner.getByText(COPY.bannerTitle, { exact: true })).toBeVisible();
    await expect(banner.getByText(COPY.bannerDesc, { exact: true })).toBeVisible();

    // Exactly the abandoned attempt is offered; nothing else is in progress.
    const openAttempts = (await listAttempts(page)).filter((item) => item.completed_at === null);
    expect(openAttempts.map((item) => item.id)).toEqual([attemptId]);

    // ── Step 3: „Kontynuuj” reopens the same quiz with the answers ─────────
    await banner.getByRole('button', { name: COPY.continueQuiz, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/app/study/session/quiz/${attemptId}$`), {
      timeout: 20_000,
    });
    await expect(page.locator('[data-slot="card-title"]')).toHaveText(firstSeed.content);
    await expect(page.getByRole('radio', { name: firstPick, exact: true })).toBeChecked();
    await expect(page.getByRole('radio', { name: firstSeed.answers[0], exact: true })).toBeChecked({
      checked: false,
    });

    await page.getByRole('button', { name: COPY.next, exact: true }).click();
    await expect(page.locator('[data-slot="card-title"]')).toHaveText(secondSeed.content);
    await expect(page.getByRole('radio', { name: secondPick, exact: true })).toBeChecked();

    // ── Step 4: leave again and press „Anuluj” ─────────────────────────────
    await sidebarQuizLink(page).click();
    await expect(page).toHaveURL(/\/app\/study\/quiz$/, { timeout: 20_000 });
    await expect(banner).toHaveCount(1);
    await banner.getByRole('button', { name: COPY.abortQuiz, exact: true }).click();

    // Known limitation in the case: abort is not implemented yet; the product
    // says so instead of failing, and the attempt stays resumable.
    await expect(
      page.getByText(COPY.abortComingSoon, { exact: true }).first(),
      'the documented „abort will be available soon” notification',
    ).toBeVisible();
    await expect(page, 'the abort does not navigate away').toHaveURL(/\/app\/study\/quiz$/);
    await expect(banner, 'the unfinished quiz is still offered').toHaveCount(1);
    const stillOpen = await getAttempt(page, attemptId);
    expect(stillOpen.completed_at, '„Anuluj” leaves the attempt open').toBeNull();
    expect(stillOpen.answers[attempt.questions[0].id]?.selected_answer_id).toBe(
      drafted.answers[attempt.questions[0].id]?.selected_answer_id,
    );

    // ── Adjacent regression: a submitted quiz no longer looks unfinished ───
    await banner.getByRole('button', { name: COPY.continueQuiz, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/app/study/session/quiz/${attemptId}$`), {
      timeout: 20_000,
    });
    await page.getByRole('button', { name: COPY.next, exact: true }).click();
    await page.getByRole('button', { name: COPY.next, exact: true }).click();
    await expect(page.locator('[data-slot="card-title"]')).toHaveText(thirdSeed.content);
    await answerVisibleQuestion(page, attemptId, thirdSeed.answers[0]);

    const submitted = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `/api/v1/quiz/${attemptId}`,
      { timeout: 20_000 },
    );
    await page.getByRole('button', { name: COPY.submit, exact: true }).click();
    expect((await submitted).status(), `POST /api/v1/quiz/${attemptId}`).toBe(200);

    await expect(page).toHaveURL(new RegExp(`/app/study/session/quiz/${attemptId}/review$`), {
      timeout: 20_000,
    });
    await expect(page.getByRole('heading', { name: COPY.reviewTitle, exact: true })).toBeVisible();
    // One wrong pick (Q1) and two correct ones (Q2, Q3) out of three.
    await expect(page.getByText(`2 z ${QUESTION_COUNT} poprawnych`, { exact: true })).toBeVisible();

    await page.goto('/app/study/quiz');
    await expect(page.getByText(COPY.noHistory, { exact: true })).toHaveCount(0);
    await expect(page.getByText(COPY.bannerDesc), 'no banner for a finished quiz').toHaveCount(0);
    await expect(page.getByText(COPY.bannerTitle, { exact: true })).toHaveCount(0);

    const history = page.locator('[data-slot="card"]').filter({ hasText: COPY.recentQuizzes });
    await expect(history.getByText(`2/${QUESTION_COUNT}`, { exact: true })).toBeVisible();
    await expect(history.getByRole('link', { name: COPY.review, exact: true })).toHaveAttribute(
      'href',
      `/app/study/session/quiz/${attemptId}/review`,
    );

    // A deep link to a finished attempt is a review, never a resumable quiz.
    await page.goto(`/app/study/session/quiz/${attemptId}`);
    await expect(page).toHaveURL(new RegExp(`/app/study/session/quiz/${attemptId}/review$`), {
      timeout: 20_000,
    });
    await expect(page.getByRole('heading', { name: COPY.reviewTitle, exact: true })).toBeVisible();
  });
});
