import { t } from '#test/e2e/utils';
import { expect, signIn, test } from '#test/e2e/fixtures/tenant';

/**
 * Regression for #320 (STU-09 steps 4–5): a standalone quiz that contains an
 * Open question could not be submitted because the typed free text was sent as
 * `selectedAnswerId`, which the server rejects with 422.
 *
 * This spec only passes once the client sends open answers as `textAnswer`.
 * It needs the seeded QA database (Classroom group open questions + `quiz`
 * feature on the base plan).
 */
// Distinct from every seeded question and explanation, so the review page can
// only contain it in the student's own answer block — `getByText` can never be
// ambiguous again (#320 review-1).
const openAnswer = 'QA-320 testowa odpowiedź otwarta.';

/** Submit hits `POST /api/v1/quiz/<uuid>`; generation uses `/new` and is excluded. */
const SUBMIT_PATH =
  /^\/api\/v1\/quiz\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const QUIZ_TAKE_URL =
  /\/app\/study\/session\/quiz\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test.describe('Standalone quiz with an open answer (#320)', () => {
  test.beforeEach(async ({ page }) => {
    // The 60s waits below are longer than Playwright's 30s default.
    test.setTimeout(120_000);

    // The tenant fixture pins `active_org_id` and performs a full login, so the
    // org-switch race this spec used to work around (#320 review-1/2) is gone.
    await signIn(page, 'student');
    await page.goto('/app/study/quiz');
    await expect(page).toHaveURL(/\/app\/study\/quiz$/);
    await expect(page.locator('#quiz-type-open')).toBeVisible();
  });

  test('submits free text as textAnswer, never as selectedAnswerId', async ({ page }) => {
    // Fail fast with the current URL if a future setup regression bounces this
    // test back to the dashboard, instead of a 60s `waitForURL` timeout.
    await expect(page).toHaveURL(/\/app\/study\/quiz$/);
    await expect(page.locator('#quiz-type-open')).toBeVisible();

    // Ask for exactly one open question: at least one must be picked, and the
    // picked question is random, so never assert on its wording.
    const openOnly = page.locator('#quiz-type-open');
    // A click issued while the page is still hydrating is swallowed; retry.
    await expect(async () => {
      await openOnly.click();
      await expect(openOnly).toHaveAttribute('aria-checked', 'true', { timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
    await page.locator('input[type="number"]').fill('1');

    // Re-assert right before generate: a late `/app` bounce would otherwise
    // surface as an opaque take-page timeout.
    await expect(page).toHaveURL(/\/app\/study\/quiz$/);
    await expect(page.locator('#quiz-type-open')).toBeVisible();

    const generate = page.getByRole('button', { name: t('AppFlashcardStudyPage.generate_quiz') });
    // `useFeature()` resolves asynchronously; the button stays disabled until then.
    await expect(generate).toBeEnabled({ timeout: 30_000 });
    await generate.click();

    await page.waitForURL(QUIZ_TAKE_URL, { timeout: 60_000 });

    // Arm the submit wait only after reaching the take page, so it cannot burn
    // its 60s budget during generation (#320 review-1 non-blocking 2a).
    const submitted = page.waitForResponse(
      (res) => res.request().method() === 'POST' && SUBMIT_PATH.test(new URL(res.url()).pathname),
      { timeout: 60_000 },
    );

    const answerBox = page.locator('textarea');
    await expect(answerBox).toHaveCount(1);
    await answerBox.fill(openAnswer);
    // The take page hardcodes the English label (pre-existing i18n gap, not
    // #320), so no Polish alternative can ever match.
    await page.getByRole('button', { name: t('AppQuizPage.submit') }).click();

    const response = await submitted;
    const body = (await response.request().postDataJSON()) as {
      answers: Array<Record<string, unknown>>;
    };

    // Pre-#406: the free text landed in `selectedAnswerId` and the server replied 422
    // with `VALIDATION_UUID_INVALID`.
    expect(response.status()).toBe(200);
    expect(body.answers).toHaveLength(1);
    expect(body.answers[0]).toEqual({ questionId: expect.any(String), textAnswer: openAnswer });

    await expect(page).toHaveURL(/\/review$/, { timeout: 30_000 });
    // `exact` matches the answer span only; the explanation block renders
    // "Wyjaśnienie: …" and is therefore not an exact match.
    await expect(page.getByText(openAnswer, { exact: true })).toBeVisible();

    // #329 — a practice quiz with only open questions has no reviewer and nothing
    // auto-graded, so the review must show the self-check badge and the dedicated
    // all-open state instead of „Pending review” / „Score: 0%”.
    // `t()` returns a RegExp, so these are substring matches by design.
    await expect(page.getByText(t('AppQuizReviewPage.badge_self_check'))).toBeVisible();
    await expect(page.getByText(t('AppQuizReviewPage.open_only_title'))).toBeVisible();
    await expect(page.getByText(t('AppQuizReviewPage.no_answer'))).toHaveCount(0);
    await expect(page.getByText(/Oczekuje na ocenę|Pending review/)).toHaveCount(0);
    await expect(page.getByText(/Wynik: \d+%|Score: \d+%/)).toHaveCount(0);

    // #619 — `/app/stats` must use the same closed-question denominator as the
    // review, so an all-open attempt shows the self-check state there too
    // (never a fabricated „0%”). The history is newest-first, so the attempt
    // just submitted is the first row. The summary cards are not asserted: the
    // seeded `student-classroom` account can have attempts from other specs.
    await page.goto('/app/stats/results');
    const historyRow = page.locator('tbody tr').first();
    await expect(historyRow.getByText(t('AppStatsPage.self_check'))).toBeVisible();
    await expect(historyRow.getByText('0%')).toHaveCount(0);
  });
});
