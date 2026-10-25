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
  test.beforeEach(async ({ page, context }) => {
    // The 60s waits below are longer than Playwright's 30s default, which would
    // otherwise fail the test first (#320 review-1 non-blocking 2a).
    test.setTimeout(120_000);

    // Arm before login: the dashboard's `useOrgs` auto-select can start as soon
    // as the authenticated layout mounts, and it must be observed, not aborted.
    const orgSwitch = page.waitForResponse(
      (res) =>
        res.request().method() === 'POST' &&
        new URL(res.url()).pathname === '/api/v1/me/orgs/switch',
      { timeout: 60_000 },
    );

    // No `next`: logging in with a deep link races the authenticated-guest guard
    // and leaves the pre-auth `features/me` 401 cached (#320 review-1
    // non-blocking 1). The guard sends a student to `/app` from here.
    await page.goto('/login');
    const emailInput = page.getByLabel(t('LoginPage.email_label'));
    await emailInput.click();
    await emailInput.fill(email);
    await expect(emailInput).toHaveValue(email);
    await page.getByLabel(t('LoginPage.password_label')).fill(password);

    const loginResponse = page.waitForResponse(
      (res) =>
        res.request().method() === 'POST' && new URL(res.url()).pathname === '/api/v1/auth/login',
      { timeout: 30_000 },
    );
    await page.getByRole('button', { name: t('LoginPage.login_button') }).click();
    expect((await loginResponse).status()).toBe(200);

    // Pathname, not the whole URL: the login URL itself ends with
    // `?next=/app/study/quiz` in other specs, so a `$`-anchored regex could
    // resolve too early.
    await page.waitForURL((url) => url.pathname.startsWith('/app'), { timeout: 30_000 });

    // `POST /api/v1/auth/login` does NOT set `active_org_id`; the dashboard's
    // `useOrgs` auto-select does. Navigating while that request is in flight
    // aborts it (status -1), and the retry on the next page calls
    // `router.push('/app')` right after generate — the #320 review-2 blocking
    // flake. Wait for the switch to settle before navigating.
    expect((await orgSwitch).status()).toBe(200);
    await expect
      .poll(async () => (await context.cookies()).some((c) => c.name === 'active_org_id'), {
        timeout: 5_000,
      })
      .toBe(true);

    // Full document load (not a client transition): the login page's providers
    // already 401'd on `/api/v1/features/me`, which would otherwise leave the
    // quiz feature disabled ("Upgrade") for the rest of the client session.
    // The org is already active, so `useOrgs` cannot auto-select and bounce.
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
    await openOnly.click();
    await expect(openOnly).toHaveAttribute('aria-checked', 'true');
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
    await page.getByRole('button', { name: 'Submit Quiz' }).click();

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
  });
});
