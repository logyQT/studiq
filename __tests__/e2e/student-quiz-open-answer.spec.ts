import { expect, test } from '@playwright/test';
import { t } from '#test/e2e/utils';

/**
 * Regression for #320 (STU-09 steps 4–5): a standalone quiz that contains an
 * Open question could not be submitted because the typed free text was sent as
 * `selectedAnswerId`, which the server rejects with 422.
 *
 * This spec only passes once the client sends open answers as `textAnswer`.
 * It needs the seeded QA database (Classroom group open questions + `quiz`
 * feature on the base plan).
 */
const email = 'student-classroom@dev.local';
const password = 'pass';
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
    // The 60s waits below are longer than Playwright's 30s default, which would
    // otherwise fail the test first (#320 review-1 non-blocking 2a).
    test.setTimeout(120_000);

    // `next` makes login land on the quiz page, so no late dashboard redirect can
    // override the navigation below (#320 review-1 non-blocking 2b). The
    // authenticated-guest guard can still win the race and land on `/app`, so
    // only wait for "somewhere inside the app" and navigate explicitly after.
    await page.goto('/login?next=/app/study/quiz');
    const emailInput = page.getByLabel(t('LoginPage.email_label'));
    await emailInput.click();
    await emailInput.fill(email);
    await expect(emailInput).toHaveValue(email);
    await page.getByLabel(t('LoginPage.password_label')).fill(password);
    await page.getByRole('button', { name: t('LoginPage.login_button') }).click();
    // Pathname, not the whole URL: the login URL itself ends with
    // `?next=/app/study/quiz`, so a `$`-anchored regex would resolve too early.
    await page.waitForURL((url) => url.pathname.startsWith('/app'), { timeout: 30_000 });

    // Full document load (not a client transition): the login page's providers
    // already 401'd on `/api/v1/features/me`, which would otherwise leave the
    // quiz feature disabled ("Upgrade") for the rest of the client session.
    await page.goto('/app/study/quiz');
  });

  test('submits free text as textAnswer, never as selectedAnswerId', async ({ page }) => {
    // Ask for exactly one open question: at least one must be picked, and the
    // picked question is random, so never assert on its wording.
    const openOnly = page.locator('#quiz-type-open');
    await openOnly.click();
    await expect(openOnly).toHaveAttribute('aria-checked', 'true');
    await page.locator('input[type="number"]').fill('1');

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
    await page.getByRole('button', { name: /Submit Quiz|Zakończ test/i }).click();

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
    // "Explanation: …" and is therefore not an exact match.
    await expect(page.getByText(openAnswer, { exact: true })).toBeVisible();
    await expect(page.getByText('Pending review')).toBeVisible();
  });
});
