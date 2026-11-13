import { expect, signIn, test } from '#test/e2e/fixtures/tenant';
import { t } from '#test/e2e/utils';

/**
 * #1066 — a double click on the submit button used to fire two
 * `POST /api/v1/quiz/<attemptId>` requests, because the button had no
 * submitting state. The server now completes an attempt once, so this spec
 * guards the client half: the first click must disable the button before the
 * second click can reach the network.
 *
 * The take page only renders the submit button on the last question, so the
 * quiz is generated as a single mcq question.
 */
const SUBMIT_PATH =
  /^\/api\/v1\/quiz\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const QUIZ_TAKE_URL =
  /\/app\/study\/session\/quiz\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test.describe('Double-clicking the quiz submit button (#1066)', () => {
  test('sends one request and stores the sheet once', async ({ page }) => {
    // Generation can wait on the quiz feature flag, which is longer than the 30s
    // default; the waits below are bounded by their own timeouts.
    test.setTimeout(120_000);

    // Fail fast if a setup regression bounced the session back to the dashboard.
    await signIn(page, 'student');
    await page.goto('/app/study/quiz');
    await expect(page).toHaveURL(/\/app\/study\/quiz$/);

    const mcqOnly = page.locator('#quiz-type-mcq');
    // A click issued while the page is still hydrating is swallowed; retry.
    await expect(async () => {
      await mcqOnly.click();
      await expect(mcqOnly).toHaveAttribute('aria-checked', 'true', { timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
    await page.locator('input[type="number"]').fill('1');

    const generate = page.getByRole('button', { name: t('AppFlashcardStudyPage.generate_quiz') });
    // `useFeature()` resolves asynchronously; the button stays disabled until then.
    await expect(generate).toBeEnabled();
    await generate.click();
    await page.waitForURL(QUIZ_TAKE_URL, { timeout: 60_000 });

    // Answer the single mcq question: an empty sheet stores no row, which would
    // make the "one row" assertion pass for the wrong reason.
    const option = page.getByRole('radio').first();
    await option.click();
    await expect(option).toBeChecked();

    const submitRequests: string[] = [];
    const submitResponses: number[] = [];
    page.on('request', (request) => {
      if (request.method() !== 'POST') return;
      const { pathname } = new URL(request.url());
      if (SUBMIT_PATH.test(pathname)) submitRequests.push(pathname);
    });
    page.on('response', (response) => {
      if (response.request().method() !== 'POST') return;
      if (SUBMIT_PATH.test(new URL(response.url()).pathname)) {
        submitResponses.push(response.status());
      }
    });

    await page.getByRole('button', { name: t('AppQuizTakingPage.submit') }).dblclick();

    await expect(page).toHaveURL(/\/review$/, { timeout: 30_000 });

    // The redirect only happens after the first POST resolves, so a second click
    // would already have dispatched its request by now.
    expect(submitRequests, 'exactly one submit request').toHaveLength(1);
    expect(submitResponses, 'the one submit was accepted').toEqual([200]);
    await expect(page.getByText(/Wynik: 100%|Score: 100%/)).toBeVisible();
  });
});
