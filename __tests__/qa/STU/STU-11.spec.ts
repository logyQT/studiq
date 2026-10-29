import { expect, test, type Page } from '@playwright/test';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

/**
 * STU-11 — Przegląd wyniku quizu (review).
 *
 * Case: from „Ostatnie quizy” open „Przejrzyj” on a completed quiz and read every
 * question. Expected: the review page lists the questions, the selected answers,
 * the correct answers and the explanations; correct/incorrect are clearly marked;
 * a missing explanation is not an error.
 *
 * Tenant (deterministic, `content` profile, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts STU-11 --fresh
 *
 * gives the case's own organization (`tenantKey('qa/cases/STU-11.md',
 * 'STU-11#<suffix>', 'qa-shared')` + `tenantId` for every id) with the default
 * group `G1`, its manager/teacher and the `student` account this case signs in
 * as. The completed quiz is built inside that tenant through the product API by
 * the same student: a personal bank with three questions — two with an
 * explanation and one without — a practice attempt generated from that bank
 * only, then submitted with one correct and two wrong answers. Nothing global
 * (plan catalogue, feature flags, admin settings, platform stats) is read or
 * written, and no other worker's tenant is touched.
 *
 * Walk on the shared app (:3010, worker qa-env-1) before writing this spec:
 * - `/app/study/quiz` lists the finished attempt under „Ostatnie quizy” with the
 *   `1/3` badge and a „Przejrzyj” link to
 *   `/app/study/session/quiz/<attemptId>/review`.
 * - The review header shows „Wynik: 33%” and „1 z 3 poprawnych”.
 * - Each question carries the „Poprawnie” / „Niepoprawnie” badge. On a multiple-
 *   choice question the correct option is green with a check icon and the wrong
 *   selection is red, struck through and marked with an X icon; on a true/false
 *   question the correct button is primary with a check and the wrong selection
 *   is the destructive (red) button with an X.
 * - „Wyjaśnienie: …” is rendered when the question has one; the question without
 *   an explanation renders normally and the page shows no error.
 *
 * The adjacent regression that matters for this surface is step 1 itself: the
 * „Ostatnie quizy” row must link to the review route for *that* attempt, and the
 * list badge must agree with the review score. The spec asserts the intended
 * behaviour only — no expected-failure branches.
 */

const CASE = 'STU-11';

const BANKS_URL = '/api/v1/questions/banks';
const QUESTIONS_URL = '/api/v1/questions';
const NEW_QUIZ_URL = '/api/v1/quiz/new';

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface QuestionAnswer {
  id: string;
  content: string;
  is_correct: boolean;
}

interface Question {
  id: string;
  content: string;
  type: 'mcq' | 'true_false' | 'open';
  explanation: string | null;
  question_answers: QuestionAnswer[];
}

interface GeneratedAttempt {
  id: string;
  questions: Question[];
}

/** The three questions the review must render; two carry an explanation, one does not. */
const MCQ_WITH_EXPLANATION = {
  content: 'Kiedy przyjęto chrzest Polski?',
  explanation: 'Chrzest Polski przyjmuje się na rok 966.',
  answers: [
    { content: '966', isCorrect: true },
    { content: '1000', isCorrect: false },
    { content: '1310', isCorrect: false },
  ],
} as const;

const TRUE_FALSE_WITH_EXPLANATION = {
  content: 'Bitwa pod Grunwaldem odbyła się w 1410 roku.',
  explanation: 'Bitwa pod Grunwaldem rozegrała się 15 lipca 1410 roku.',
  answers: [
    { content: 'Prawda', isCorrect: true },
    { content: 'Fałsz', isCorrect: false },
  ],
} as const;

const MCQ_WITHOUT_EXPLANATION = {
  content: 'Kto był pierwszym historycznym władcą Polski?',
  answers: [
    { content: 'Mieszko I', isCorrect: true },
    { content: 'Bolesław Chrobry', isCorrect: false },
    { content: 'Kazimierz Wielki', isCorrect: false },
  ],
} as const;

/** `POST` and require the created (201) envelope, returning its `data`. */
async function postData<T>(page: Page, url: string, data: unknown): Promise<T> {
  const response = await page.request.post(url, { data });
  const body = (await response.json()) as Envelope<T>;
  expect(response.status(), `POST ${url} → ${response.status()} ${JSON.stringify(body)}`).toBe(201);
  expect(body.success, `POST ${url} success flag`).toBe(true);
  expect(body.data, `POST ${url} payload`).toBeTruthy();
  return body.data as T;
}

/** The id of one option by its visible text; a missing option is a fixture bug. */
function answerId(question: Question, content: string): string {
  const answer = question.question_answers.find((candidate) => candidate.content === content);
  if (!answer) {
    throw new Error(`question „${question.content}” has no answer „${content}”`);
  }
  return answer.id;
}

/** The card that owns one question, matched by its (unique) content. */
function questionCard(page: Page, content: string) {
  return page.locator('main [data-slot="card"]').filter({ hasText: content });
}

test.describe('@case:STU-11 @area:STU @prio:P1 quiz review', () => {
  test('„Ostatnie quizy” opens the review with selected, correct and explained answers', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');

    const pageErrors: string[] = [];
    const failedQuizReads: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('response', (response) => {
      const path = new URL(response.url()).pathname;
      if (/^\/api\/v1\/quiz\/[0-9a-f-]{36}$/.test(path) && response.status() >= 400) {
        failedQuizReads.push(`${response.status()} ${path}`);
      }
    });

    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
    expect(new URL(page.url()).pathname, 'the student lands on /app').toBe('/app');
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

    // Prerequisite: a completed quiz. Everything is created through the product
    // API in this tenant's student session; the bank is the only source of the
    // attempt, so the generated quiz is deterministic in content.
    const bank = await postData<{ id: string }>(page, BANKS_URL, {
      name: `STU-11 bank ${tenant.runSuffix ?? tenant.key.slice(-6)}`,
    });

    const q1 = await postData<Question>(page, QUESTIONS_URL, {
      bankId: bank.id,
      type: 'mcq',
      content: MCQ_WITH_EXPLANATION.content,
      explanation: MCQ_WITH_EXPLANATION.explanation,
      answers: MCQ_WITH_EXPLANATION.answers.map((answer, orderIndex) => ({
        ...answer,
        orderIndex,
      })),
    });
    const q2 = await postData<Question>(page, QUESTIONS_URL, {
      bankId: bank.id,
      type: 'true_false',
      content: TRUE_FALSE_WITH_EXPLANATION.content,
      explanation: TRUE_FALSE_WITH_EXPLANATION.explanation,
      answers: TRUE_FALSE_WITH_EXPLANATION.answers.map((answer, orderIndex) => ({
        ...answer,
        orderIndex,
      })),
    });
    const q3 = await postData<Question>(page, QUESTIONS_URL, {
      bankId: bank.id,
      type: 'mcq',
      content: MCQ_WITHOUT_EXPLANATION.content,
      answers: MCQ_WITHOUT_EXPLANATION.answers.map((answer, orderIndex) => ({
        ...answer,
        orderIndex,
      })),
    });
    expect(q3.explanation ?? null, 'the third question has no explanation').toBeNull();

    const attempt = await postData<GeneratedAttempt>(page, NEW_QUIZ_URL, {
      bankId: bank.id,
      questionTypes: ['mcq', 'true_false'],
      questionCount: 3,
    });
    expect(attempt.id, 'generated attempt id').toBeTruthy();
    expect(
      attempt.questions.map((question) => question.id).sort(),
      'the attempt contains exactly the bank questions',
    ).toEqual([q1.id, q2.id, q3.id].sort());

    // One correct answer and two deliberately wrong ones, so the review has both
    // states to mark: Q1 → wrong option „1000”, Q2 → wrong „Fałsz”, Q3 → correct.
    const submitted = await page.request.post(`/api/v1/quiz/${attempt.id}`, {
      data: {
        attemptId: attempt.id,
        answers: [
          { questionId: q1.id, selectedAnswerId: answerId(q1, '1000') },
          { questionId: q2.id, selectedAnswerId: answerId(q2, 'Fałsz') },
          { questionId: q3.id, selectedAnswerId: answerId(q3, 'Mieszko I') },
        ],
      },
    });
    expect(submitted.status(), 'POST /api/v1/quiz/<attemptId>').toBe(200);
    expect((await submitted.json()) as { data: unknown }).toMatchObject({
      data: { score: 1, totalQuestions: 3 },
    });

    // 1. From „Ostatnie quizy”, open „Przejrzyj” for this attempt.
    await page.goto('/app/study/quiz');
    await expect(page).toHaveURL(/\/app\/study\/quiz$/);

    const recent = page.locator('main [data-slot="card"]').filter({ hasText: 'Ostatnie quizy' });
    await expect(recent, '„Ostatnie quizy” lists the finished quiz').toBeVisible();
    await expect(recent, 'the empty history state is gone').not.toContainText(
      'Brak historii quizów',
    );
    const row = recent.locator('li').filter({ has: page.getByRole('link', { name: 'Przejrzyj' }) });
    await expect(row, 'one completed practice attempt').toHaveCount(1);
    await expect(row.locator('[data-slot="badge"]'), 'the list badge matches 1/3').toHaveText(
      '1/3',
    );

    const reviewLink = row.getByRole('link', { name: 'Przejrzyj', exact: true });
    await expect(reviewLink).toHaveAttribute(
      'href',
      `/app/study/session/quiz/${attempt.id}/review`,
    );
    await reviewLink.click();
    await page.waitForURL(`**/app/study/session/quiz/${attempt.id}/review`, { timeout: 15_000 });

    // 2. Review header and every question.
    await expect(
      page.locator('h2').filter({ hasText: 'Wyniki testu' }),
      'the review page title',
    ).toBeVisible();
    await expect(page.getByText('Wynik: 33%', { exact: true })).toBeVisible();
    await expect(page.getByText('1 z 3 poprawnych', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Wróć do nauki', exact: true }),
      'the way back to study',
    ).toHaveAttribute('href', '/app/study');

    // 2a. Wrong multiple-choice question: selected option struck through + X,
    //     correct option green + check, and the explanation below.
    const q1Card = questionCard(page, MCQ_WITH_EXPLANATION.content);
    await expect(q1Card).toBeVisible();
    await expect(
      q1Card.locator('[data-slot="badge"]').filter({ hasText: 'Niepoprawnie' }),
    ).toBeVisible();
    await expect(q1Card).toContainText('Wielokrotny wybór');

    const q1Correct = q1Card.locator('[data-correct="true"]');
    await expect(q1Correct, 'the correct option is marked once').toHaveCount(1);
    await expect(q1Correct).toContainText('966');
    await expect(q1Correct.locator('svg[aria-label="Poprawnie"]')).toBeVisible();

    const q1Wrong = q1Card.locator('[data-selected="true"]');
    await expect(q1Wrong, 'the selected (wrong) option is marked once').toHaveCount(1);
    await expect(q1Wrong).toContainText('1000');
    await expect(q1Wrong.locator('svg[aria-label="Niepoprawnie"]')).toBeVisible();
    await expect(
      q1Wrong.locator('span').filter({ hasText: '1000' }),
      'the wrong selection is struck through',
    ).toHaveCSS('text-decoration-line', 'line-through');
    await expect(q1Card).toContainText(`Wyjaśnienie: ${MCQ_WITH_EXPLANATION.explanation}`);

    // 2b. Wrong true/false question: the correct button is primary, the selected
    //     wrong button is destructive, each with its own icon.
    const q2Card = questionCard(page, TRUE_FALSE_WITH_EXPLANATION.content);
    await expect(q2Card).toBeVisible();
    await expect(
      q2Card.locator('[data-slot="badge"]').filter({ hasText: 'Niepoprawnie' }),
    ).toBeVisible();
    await expect(q2Card).toContainText('Prawda / Fałsz');

    const trueButton = q2Card.locator('button').filter({ hasText: 'Prawda' });
    await expect(trueButton, 'the correct true/false option').toHaveCount(1);
    await expect(trueButton).toHaveClass(/bg-primary/);
    await expect(trueButton.locator('svg[aria-label="Poprawnie"]')).toBeVisible();
    await expect(trueButton, 'review choices are not interactive').toBeDisabled();

    const falseButton = q2Card.locator('button').filter({ hasText: 'Fałsz' });
    await expect(falseButton, 'the selected wrong true/false option').toHaveCount(1);
    await expect(falseButton).toHaveClass(/bg-destructive/);
    await expect(falseButton.locator('svg[aria-label="Niepoprawnie"]')).toBeVisible();
    await expect(falseButton).toBeDisabled();
    await expect(q2Card).toContainText(`Wyjaśnienie: ${TRUE_FALSE_WITH_EXPLANATION.explanation}`);

    // 2c. Correct question: marked „Poprawnie”, correct option green + check, and
    //     no selected-wrong highlight. It has no explanation — that must not be
    //     an error and must not break the page.
    const q3Card = questionCard(page, MCQ_WITHOUT_EXPLANATION.content);
    await expect(q3Card).toBeVisible();
    await expect(
      q3Card.locator('[data-slot="badge"]').filter({ hasText: 'Poprawnie' }),
    ).toBeVisible();
    await expect(q3Card.locator('[data-correct="true"]'), 'the correct option').toHaveCount(1);
    await expect(q3Card.locator('[data-correct="true"]')).toContainText('Mieszko I');
    await expect(q3Card.locator('[data-selected="true"]'), 'nothing is selected wrong').toHaveCount(
      0,
    );
    await expect(q3Card, 'no explanation block for the question without one').not.toContainText(
      'Wyjaśnienie',
    );

    // The review is a real page, not the not-found state, and every attempt read
    // succeeded.
    await expect(page.getByText('Nie znaleziono')).toHaveCount(0);
    await expect(page.getByText('Nie udało się wczytać testu')).toHaveCount(0);
    expect(failedQuizReads, 'the review read the attempt without an error status').toEqual([]);
    expect(pageErrors, 'uncaught page errors during the review').toEqual([]);
  });
});
