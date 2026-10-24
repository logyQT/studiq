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
const openAnswer = 'Energia słoneczna, wiatrowa i wodna.';

/** Submit hits `POST /api/v1/quiz/<uuid>`; generation uses `/new` and is excluded. */
const SUBMIT_PATH =
  /^\/api\/v1\/quiz\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test.describe('Standalone quiz with an open answer (#320)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    const emailInput = page.getByLabel(t('LoginPage.email_label'));
    await emailInput.click();
    await emailInput.fill(email);
    await expect(emailInput).toHaveValue(email);
    await page.getByLabel(t('LoginPage.password_label')).fill(password);
    await page.getByRole('button', { name: t('LoginPage.login_button') }).click();
    await page.waitForURL(/\/app/, { timeout: 30_000 });
  });

  test('submits free text as textAnswer, never as selectedAnswerId', async ({ page }) => {
    await page.goto('/app/study/quiz');

    // Ask for exactly one open question: at least one must be picked, and the
    // picked question is random, so never assert on its wording.
    const openOnly = page.locator('#quiz-type-open');
    await openOnly.click();
    await expect(openOnly).toHaveAttribute('aria-checked', 'true');
    await page.locator('input[type="number"]').fill('1');

    // Register before generating so the later submit response cannot be missed.
    const submitted = page.waitForResponse(
      (res) => res.request().method() === 'POST' && SUBMIT_PATH.test(new URL(res.url()).pathname),
      { timeout: 60_000 },
    );

    const generate = page.getByRole('button', { name: t('AppFlashcardStudyPage.generate_quiz') });
    // `useFeature()` resolves asynchronously; the button stays disabled until then.
    await expect(generate).toBeEnabled({ timeout: 30_000 });
    await generate.click();

    await page.waitForURL(
      /\/app\/study\/session\/quiz\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      { timeout: 60_000 },
    );

    await page.locator('textarea[placeholder="Type your answer..."]').fill(openAnswer);
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
    await expect(page.getByText(openAnswer)).toBeVisible();
    await expect(page.getByText('Pending review')).toBeVisible();
  });
});
