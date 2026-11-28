import { expect, test, type APIResponse, type Page } from '@playwright/test';
import { json } from '#test/helpers/json';
import { FIXTURE_EXPLANATION, FIXTURE_MODEL_ANSWER } from '#test/helpers/question-text';
import { loadTenant, loginAs, type QaTenant } from '#test/qa/fixtures/tenant';

/**
 * STU-09 — Wygenerowanie i rozwiązanie quizu (student, `/app/study/quiz`).
 *
 * Case: open `/app/study/quiz`, start „Nowy quiz” with every subject, the three
 * question types and 5 questions, generate it, answer all five with „Poprzednie”
 * / „Następne”, then „Zakończ test”. Expected: the attempt opens at
 * `/app/study/session/quiz/<id>` with „Pytanie X z 5”; choice questions render
 * radios, true/false renders „Prawda” / „Fałsz”, an open question renders a text
 * field; the result screen shows the score and the attempt lands in
 * „Ostatnie quizy”.
 *
 * Tenant: the default `content` shape (no profile file), seeded before every
 * independent run:
 *
 *   bun scripts/qa-tenant.ts STU-09 --fresh
 *
 * The seeder builds only the graph (org + manager/educator/student + `G1`), so
 * the case's prerequisite — 10 questions in 2 banks — is created inside that
 * tenant by the student through the product API: two banks of five questions
 * each, 4 multiple-choice, 3 true/false and 3 open, with the authoring artefacts
 * R16/R17 requires. The questions are reused when a retry hits the same tenant,
 * so the pool never doubles. Nothing global is read or written.
 *
 * Walk (2026-11-28, `test/qa-STU-09` @ `896687d68`, Polish UI):
 * 1. There is no „Quiz” tab: the sidebar link `/app/study/quiz` opens the
 *    generator directly. The subject select renders only when the tenant has
 *    topics; with none, the generator's default is all subjects, which the
 *    attempt's `config` (no `topicIds`, `questionTypes` = the three boxes,
 *    `questionCount` = 5) proves. The spec asserts the shipped UI, not the tab.
 * 2. The generator samples 5 of the 10 questions at random, so one draw is not
 *    guaranteed to contain all three types the expected result names. The spec
 *    draws again (bounded, each draw is one of the free plan's 10 daily
 *    attempts) until the attempt carries at least one of each; it then asserts
 *    the control for every sampled question's type.
 * 3. A finished mixed quiz renders „Wyniki testu” with
 *    „Poprawnie: N z M pytań zamkniętych” and „Pytania otwarte: K — sprawdź
 *    samodzielnie”; open answers are never auto-graded, so they are not in M.
 *    The case's „Test ukończony!” copy does not exist in the product (it is an
 *    unused catalogue key); the spec asserts the shipped result screen.
 * 4. „Ostatnie quizy” lists the completed practice attempt with its `N/M` badge
 *    and a „Przejrzyj” link to that attempt's review.
 *
 * The result is computed by the product: all closed questions are answered
 * correctly except the first one, so N = M − 1 and the persisted score, the
 * review summary and the list badge must all agree. A regression that miscounts
 * the score, drops the completion or stops listing the attempt turns the spec
 * red on the assertion that names it.
 *
 * Mutation (proves this spec can fail): in `quiz-attempt.service.ts` every
 * correct practice answer scored 2 instead of 1 (`score += … : 2`). The review
 * summary assertion went red: expected „Poprawnie: 3 z 4 pytań zamkniętych”,
 * received „Poprawnie: 6 z 4 pytań zamkniętych”.
 */

const CASE = 'STU-09';
const BANKS_URL = '/api/v1/questions/banks';
const QUESTIONS_URL = '/api/v1/questions';
const QUESTION_COUNT = 5;
/** The case's pool: 10 questions in 2 banks of 5. */
const BANK_SIZE = 5;
/**
 * The free plan allows 10 practice attempts a day, and the generator picks 5 of
 * 10 at random, so 8 draws make a type-less draw practically impossible (each
 * draw misses a type with probability ≈ 0.19).
 */
const MAX_DRAWS = 8;

/** Polish copy the case quotes, plus the shipped result screen (walk step 3). */
const COPY = {
  newQuiz: 'Nowy quiz',
  generate: 'Generuj quiz',
  typeMcq: 'Wielokrotny wybór',
  typeTrueFalse: 'Prawda / Fałsz',
  typeOpen: 'Otwarta odpowiedź',
  previous: 'Poprzednie',
  next: 'Następne',
  submit: 'Zakończ test',
  reviewTitle: 'Wyniki testu',
  recentQuizzes: 'Ostatnie quizy',
  noHistory: 'Brak historii quizów',
  review: 'Przejrzyj',
  correct: 'Prawda',
  incorrect: 'Fałsz',
  answerPlaceholder: 'Wpisz swoją odpowiedź…',
} as const;

const TYPE_LABELS = [COPY.typeMcq, COPY.typeTrueFalse, COPY.typeOpen] as const;

const TYPE_BADGE: Record<SeedType, string> = {
  mcq: COPY.typeMcq,
  true_false: COPY.typeTrueFalse,
  open: COPY.typeOpen,
};

const CORRECT_OPTION = 'Odpowiedź poprawna';
const WRONG_OPTION = 'Odpowiedź błędna';

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface Bank {
  id: string;
  name: string;
  organization_id: string | null;
}

interface StoredQuestion {
  id: string;
  content: string;
}

interface AttemptQuestion {
  id: string;
  content: string;
  type: SeedType;
  question_answers: Array<{ id: string; content: string }>;
}

interface Attempt {
  id: string;
  completed_at: string | null;
  total_questions: number;
  config: { questionTypes?: string[]; questionCount?: number; topicIds?: string[] } | null;
  questions: AttemptQuestion[];
}

interface AttemptRow {
  id: string;
  score: number | null;
  total_questions: number;
  gradable_questions: number;
  completed_at: string | null;
}

type SeedType = 'mcq' | 'true_false' | 'open';

/** 5 per bank, alternating banks; 4 mcq, 3 true/false, 3 open in the pool. */
const POOL_TYPES: readonly SeedType[] = [
  'mcq',
  'true_false',
  'open',
  'mcq',
  'true_false',
  'open',
  'mcq',
  'true_false',
  'open',
  'mcq',
];

async function expectApi<T>(response: APIResponse, label: string): Promise<T> {
  const body = await json<ApiEnvelope<T>>(response);
  expect(
    response.status(),
    `${label} → ${response.status()} ${JSON.stringify(body).slice(0, 300)}`,
  ).toBeLessThan(300);
  expect(body.success, `${label} success flag`).toBe(true);
  return body.data;
}

function questionContent(index: number, run: string): string {
  return `${CASE} pytanie ${index + 1} ${run}`;
}

/** The banks of the pool, reused by name so a retry on the same tenant adds none. */
async function ensurePoolBanks(page: Page, tenant: QaTenant, run: string): Promise<Bank[]> {
  const listed = await expectApi<{ items: Bank[] }>(
    await page.request.get(`${BANKS_URL}?limit=100`),
    'GET /api/v1/questions/banks',
  );
  const banks: Bank[] = [];
  for (const suffix of ['A', 'B'] as const) {
    const name = `${CASE} ${suffix} ${run}`;
    const existing = listed.items.find(
      (bank) => bank.name === name && bank.organization_id === tenant.org?.id,
    );
    banks.push(
      existing ??
        (await expectApi<Bank>(
          await page.request.post(BANKS_URL, { data: { name } }),
          `POST ${BANKS_URL} (${name})`,
        )),
    );
  }
  return banks;
}

/**
 * The case's 10 questions, created once per tenant through the product API. The
 * first option of every choice item is the correct one, so the spec never has to
 * read the answer key from an in-progress payload (it withholds it).
 */
async function ensurePoolQuestions(
  page: Page,
  banks: Bank[],
  run: string,
): Promise<StoredQuestion[]> {
  const questions: StoredQuestion[] = [];
  for (const [index, type] of POOL_TYPES.entries()) {
    const bank = banks[Math.floor(index / BANK_SIZE)];
    if (!bank) throw new Error(`${CASE} pool bank is missing`);
    const content = questionContent(index, run);
    const stored = await expectApi<StoredQuestion[]>(
      await page.request.get(`${QUESTIONS_URL}?bankId=${bank.id}`),
      `GET ${QUESTIONS_URL}?bankId=${bank.id}`,
    );
    const existing = stored.find((question) => question.content === content);
    if (existing) {
      questions.push(existing);
      continue;
    }

    const answers =
      type === 'open'
        ? []
        : type === 'true_false'
          ? [
              { content: COPY.correct, isCorrect: true, orderIndex: 0 },
              { content: COPY.incorrect, isCorrect: false, orderIndex: 1 },
            ]
          : [
              { content: CORRECT_OPTION, isCorrect: true, orderIndex: 0 },
              { content: WRONG_OPTION, isCorrect: false, orderIndex: 1 },
            ];

    questions.push(
      await expectApi<StoredQuestion>(
        await page.request.post(QUESTIONS_URL, {
          data: {
            bankId: bank.id,
            type,
            content,
            answers,
            ...(type === 'open'
              ? { modelAnswer: FIXTURE_MODEL_ANSWER }
              : { explanation: FIXTURE_EXPLANATION }),
          },
        }),
        `POST ${QUESTIONS_URL} (${content})`,
      ),
    );
  }
  return questions;
}

async function getAttempt(page: Page, attemptId: string): Promise<Attempt> {
  return expectApi<Attempt>(
    await page.request.get(`/api/v1/quiz/${attemptId}`),
    `GET /api/v1/quiz/${attemptId}`,
  );
}

/** Sets the case's generator configuration and starts a quiz from `/app/study/quiz`. */
async function generateQuiz(page: Page): Promise<string> {
  await page.goto('/app/study/quiz');
  await expect(page.getByText(COPY.newQuiz, { exact: true })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/app/study/quiz');

  for (const label of TYPE_LABELS) {
    const checkbox = page.getByRole('checkbox', { name: label, exact: true });
    await checkbox.click();
    await expect(checkbox, `„${label}” is selected`).toBeChecked();
  }

  await page.locator('input[type="number"]').fill(String(QUESTION_COUNT));
  await page.getByRole('button', { name: COPY.generate, exact: true }).click();
  await expect(page).toHaveURL(/\/app\/study\/session\/quiz\/[0-9a-f-]{36}$/, {
    timeout: 20_000,
  });
  return new URL(page.url()).pathname.split('/').pop() ?? '';
}

/** The question card's title is the stem; it must be the attempt's current question. */
async function expectCurrentQuestion(page: Page, position: number, question: AttemptQuestion) {
  await expect(
    page.getByText(`Pytanie ${position} z ${QUESTION_COUNT}`, { exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-slot="card-title"]')).toHaveText(question.content);
  await expect(
    page
      .locator('main [data-slot="badge"]')
      .filter({ hasText: new RegExp(`^${TYPE_BADGE[question.type]}$`) }),
  ).toBeVisible();
}

/** Answers the visible question; one closed question is deliberately wrong. */
async function answerQuestion(page: Page, question: AttemptQuestion, wrong: boolean) {
  if (question.type === 'open') {
    const textarea = page.locator('textarea');
    await expect(textarea).toHaveCount(1);
    await expect(textarea).toHaveAttribute('placeholder', COPY.answerPlaceholder);
    await textarea.fill(`Odpowiedź na ${question.content}`);
    await expect(textarea).toHaveValue(`Odpowiedź na ${question.content}`);
    return;
  }

  if (question.type === 'mcq') {
    const radios = page.getByRole('radio');
    await expect(radios, 'a multiple-choice question renders one radio per option').toHaveCount(
      question.question_answers.length,
    );
    const pick = wrong ? WRONG_OPTION : CORRECT_OPTION;
    const radio = page.getByRole('radio', { name: pick, exact: true });
    await radio.click();
    await expect(radio).toBeChecked();
    return;
  }

  // A true/false question is two pressed-state buttons, not radios.
  await expect(page.getByRole('radio')).toHaveCount(0);
  const pick = wrong ? COPY.incorrect : COPY.correct;
  const button = page.getByRole('button', { name: pick, exact: true });
  await expect(button).toBeVisible();
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
}

/** „Pytanie otwarte: 1 …” vs „Pytania otwarte: N …” — the product's Polish plural. */
function openQuestionsLine(count: number): string {
  const head = count === 1 ? 'Pytanie otwarte' : 'Pytania otwarte';
  return `${head}: ${count} — sprawdź samodzielnie`;
}

test.describe('@case:STU-09 @area:STU @prio:P1 generate and answer a quiz', () => {
  test('generates a 5-question quiz, answers every type and shows the result in history', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} runs on the content profile`).toBe('content');
    expect(
      tenant.runSuffix,
      'seed with --fresh: every independent run owns a new tenant',
    ).toBeTruthy();
    expect(tenant.org, 'the student under test belongs to the tenant organization').toBeTruthy();

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
    await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

    // ── Prerequisite: the tenant's own 10 questions in 2 banks ───────────────
    const run = tenant.runSuffix ?? tenant.key.slice(-6);
    const banks = await ensurePoolBanks(page, tenant, run);
    const pool = await ensurePoolQuestions(page, banks, run);
    expect(pool, `the pool holds the case's ${POOL_TYPES.length} questions`).toHaveLength(
      POOL_TYPES.length,
    );
    const poolIds = new Set(pool.map((question) => question.id));

    // ── Steps 1–3: „Nowy quiz” with three types and 5 questions ──────────────
    // The draw is random, and the expected result names all three type controls,
    // so draw until the attempt carries each of them.
    const drawn: Array<{ attempt: Attempt; types: Set<SeedType> }> = [];
    for (let draw = 1; draw <= MAX_DRAWS; draw++) {
      const attemptId = await generateQuiz(page);
      const attempt = await getAttempt(page, attemptId);
      expect(attempt.completed_at, 'a freshly generated attempt is in progress').toBeNull();
      const types = new Set(attempt.questions.map((question) => question.type));
      drawn.push({ attempt, types });
      if (types.size === TYPE_LABELS.length) break;
      // A draw without a type is discarded; the next one configures the page again.
      console.log(`${CASE} draw ${draw} without a type: ${[...types].join(', ')}`);
    }

    const chosen = drawn.find(({ types }) => types.size === TYPE_LABELS.length);
    expect(
      chosen,
      `${CASE}: none of ${MAX_DRAWS} draws carried all three types (${drawn
        .map(({ types }) => [...types].toSorted().join('+'))
        .join(' | ')})`,
    ).toBeDefined();
    if (!chosen) throw new Error(`${CASE} the generator produced no mixed quiz`);
    const attempt = chosen.attempt;

    // The configuration the form submitted is the case's: all three types, 5
    // questions, and no topic filter („Wszystkie przedmioty”).
    expect(attempt.questions, `the attempt holds ${QUESTION_COUNT} questions`).toHaveLength(
      QUESTION_COUNT,
    );
    expect(attempt.total_questions).toBe(QUESTION_COUNT);
    expect(attempt.config?.questionCount).toBe(QUESTION_COUNT);
    expect(attempt.config?.questionTypes?.toSorted()).toEqual(
      ['mcq', 'open', 'true_false'].toSorted(),
    );
    expect(
      attempt.config?.topicIds,
      '„Wszystkie przedmioty” sends no topic filter',
    ).toBeUndefined();
    for (const question of attempt.questions) {
      expect(
        poolIds.has(question.id),
        `„${question.content}” is one of the tenant's questions`,
      ).toBe(true);
    }

    const closed = attempt.questions.filter((question) => question.type !== 'open');
    const open = attempt.questions.filter((question) => question.type === 'open');
    expect(closed.length, 'the mixed quiz has at least one auto-graded question').toBeGreaterThan(
      0,
    );
    expect(open.length, 'the mixed quiz has at least one open question').toBeGreaterThan(0);
    // The first closed question is answered wrong on purpose; open answers never
    // score, so the expected result is computed by the product from these picks.
    const wrongQuestionId = closed[0]?.id ?? '';
    const expectedScore = closed.length - 1;

    // ── Steps 4–5: answer every question, „Poprzednie” / „Następne” ──────────
    await expect(
      page.getByRole('button', { name: COPY.previous, exact: true }),
      '„Poprzednie” is disabled on the first question',
    ).toBeDisabled();

    for (const [index, question] of attempt.questions.entries()) {
      const position = index + 1;
      await expectCurrentQuestion(page, position, question);
      const wrong = question.id === wrongQuestionId;
      await answerQuestion(page, question, wrong);

      if (position === 2) {
        // Second question: step back to the first one and forward again. Both
        // directions keep the answers already given.
        await page.getByRole('button', { name: COPY.previous, exact: true }).click();
        const first = attempt.questions[0];
        if (!first) throw new Error(`${CASE} attempt has no first question`);
        await expectCurrentQuestion(page, 1, first);
        if (first.type === 'open') {
          await expect(page.locator('textarea')).toHaveValue(`Odpowiedź na ${first.content}`);
        } else if (first.type === 'mcq') {
          await expect(
            page.getByRole('radio', {
              name: first.id === wrongQuestionId ? WRONG_OPTION : CORRECT_OPTION,
              exact: true,
            }),
          ).toBeChecked();
        } else {
          await expect(
            page.getByRole('button', {
              name: first.id === wrongQuestionId ? COPY.incorrect : COPY.correct,
              exact: true,
            }),
          ).toHaveAttribute('aria-pressed', 'true');
        }
        await page.getByRole('button', { name: COPY.next, exact: true }).click();
        await expectCurrentQuestion(page, position, question);
      }

      if (position < QUESTION_COUNT) {
        await page.getByRole('button', { name: COPY.next, exact: true }).click();
      }
    }

    // ── Step 5: „Zakończ test” ───────────────────────────────────────────────
    await expect(page.getByRole('button', { name: COPY.next, exact: true })).toHaveCount(0);
    const submitted = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `/api/v1/quiz/${attempt.id}`,
      { timeout: 20_000 },
    );
    await page.getByRole('button', { name: COPY.submit, exact: true }).click();
    expect((await submitted).status(), `POST /api/v1/quiz/${attempt.id}`).toBe(200);

    // ── Expected result: the result screen with the product's score ─────────
    await expect(page).toHaveURL(new RegExp(`/app/study/session/quiz/${attempt.id}/review$`), {
      timeout: 20_000,
    });
    await expect(page.getByRole('heading', { name: COPY.reviewTitle, exact: true })).toBeVisible();

    const scoreCard = page.locator('main [data-slot="card"]').first();
    await expect(scoreCard).toContainText(
      `Poprawnie: ${expectedScore} z ${closed.length} pytań zamkniętych`,
    );
    await expect(scoreCard).toContainText(openQuestionsLine(open.length));

    // The review renders the attempt's five questions.
    await expect(page.locator('main [data-slot="card"]')).toHaveCount(1 + QUESTION_COUNT);

    // ── Expected result: the attempt and its score in „Ostatnie quizy” ──────
    const history = await expectApi<AttemptRow[]>(
      await page.request.get('/api/v1/quiz/attempts'),
      'GET /api/v1/quiz/attempts',
    );
    const stored = history.find((row) => row.id === attempt.id);
    expect(stored, 'the completed attempt is in the student history').toBeTruthy();
    expect(stored?.completed_at, 'the attempt is stamped as completed').not.toBeNull();
    expect(stored?.score, 'the persisted score equals the review summary').toBe(expectedScore);
    expect(stored?.gradable_questions, 'the denominator is the closed-question count').toBe(
      closed.length,
    );

    // Reload the generator page: the list must come from the stored row, not
    // from the screen the submit just left.
    await page.goto('/app/study/quiz');
    await expect(page.getByText(COPY.recentQuizzes, { exact: true })).toBeVisible();
    await expect(page.getByText(COPY.noHistory, { exact: true })).toHaveCount(0);
    const historyCard = page
      .locator('main [data-slot="card"]')
      .filter({ hasText: COPY.recentQuizzes });
    const row = historyCard
      .locator('li')
      .filter({ has: page.locator(`a[href="/app/study/session/quiz/${attempt.id}/review"]`) });
    await expect(row, '„Ostatnie quizy” lists this attempt once').toHaveCount(1);
    await expect(row.locator('[data-slot="badge"]')).toHaveText(
      `${expectedScore}/${closed.length}`,
    );
    await expect(row.getByRole('link', { name: COPY.review, exact: true })).toBeVisible();

    expect(pageErrors, 'uncaught page errors during the quiz flow').toEqual([]);
  });
});
