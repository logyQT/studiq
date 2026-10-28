import { t } from '#test/e2e/utils';
import { expect, signIn, test } from '#test/e2e/fixtures/tenant';

/**
 * Regression for #323 (STU-09 step 2): the „Nowy quiz” form had no subject
 * selector at all, so a standalone quiz always mixed every accessible bank.
 *
 * Needs the seeded QA database (Classroom org with the „Średniowiecze” and
 * „Odkrycia geograficzne” group topics + `quiz` feature on the base plan).
 */
const QUIZ_TAKE_URL =
  /\/app\/study\/session\/quiz\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type TopicOption = { id: string; name: string };

test.describe('Standalone quiz subject selector (#323)', () => {
  test.beforeEach(async ({ page }) => {
    // The 60s waits below are longer than Playwright's 30s default.
    test.setTimeout(120_000);

    await signIn(page, 'student');
    await page.goto('/app/study/quiz');
    await expect(page).toHaveURL(/\/app\/study\/quiz$/);
    await expect(page.locator('#quiz-type-open')).toBeVisible();
  });

  test('defaults to All subjects and scopes generation to the chosen topic', async ({ page }) => {
    const topicsResponse = await page.request.get('/api/v1/topics?limit=100');
    expect(topicsResponse.status()).toBe(200);
    const topicsBody = (await topicsResponse.json()) as { data: { items: TopicOption[] } };
    const topics = topicsBody.data.items;
    // The seeded Classroom org must expose both group topics.
    expect(topics.length).toBeGreaterThan(0);

    const subjectSelect = page.getByRole('combobox', {
      name: t('AppFlashcardStudyPage.quiz_subject'),
    });
    await expect(subjectSelect).toBeVisible({ timeout: 30_000 });
    // Default is „Wszystkie przedmioty” (the sentinel item, not an empty value).
    await expect(subjectSelect).toContainText(t('AppFlashcardStudyPage.quiz_subject_placeholder'));

    // One sentinel + one entry per accessible topic.
    await subjectSelect.click();
    await expect(page.getByRole('option')).toHaveCount(topics.length + 1);

    const chosenTopic = topics[0];
    await page.getByRole('option', { name: chosenTopic.name, exact: true }).click();
    await expect(subjectSelect).toContainText(chosenTopic.name);

    // A single open question keeps the attempt completable below (#320 pattern).
    const openOnly = page.locator('#quiz-type-open');
    // A click issued while the page is still hydrating is swallowed; retry.
    await expect(async () => {
      await openOnly.click();
      await expect(openOnly).toHaveAttribute('aria-checked', 'true', { timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
    await page.locator('input[type="number"]').fill('1');

    // Baseline questions for the chosen subject, so the generated quiz can be
    // proven to be scoped instead of merely "some" questions.
    const baselineResponse = await page.request.get(`/api/v1/questions?topicIds=${chosenTopic.id}`);
    expect(baselineResponse.status()).toBe(200);
    const baselineBody = (await baselineResponse.json()) as { data: Array<{ id: string }> };
    const baselineIds = new Set(baselineBody.data.map((question) => question.id));
    expect(baselineIds.size).toBeGreaterThan(0);

    const generateRequest = page.waitForRequest(
      (req) => req.method() === 'POST' && new URL(req.url()).pathname === '/api/v1/quiz/new',
      { timeout: 60_000 },
    );
    const generateResponse = page.waitForResponse(
      (res) =>
        res.request().method() === 'POST' && new URL(res.url()).pathname === '/api/v1/quiz/new',
      { timeout: 60_000 },
    );

    const generate = page.getByRole('button', { name: t('AppFlashcardStudyPage.generate_quiz') });
    // `useFeature()` resolves asynchronously; the button stays disabled until then.
    await expect(generate).toBeEnabled({ timeout: 30_000 });
    await generate.click();

    const requestBody = (await generateRequest).postDataJSON() as {
      questionTypes?: string[];
      questionCount?: number;
      topicIds?: string[];
    };
    expect(requestBody.topicIds).toEqual([chosenTopic.id]);

    const generated = await generateResponse;
    expect(generated.status()).toBe(201);
    const generatedBody = (await generated.json()) as {
      data: { questions: Array<{ id: string }> };
    };
    expect(generatedBody.data.questions.length).toBe(1);
    for (const question of generatedBody.data.questions) {
      expect(baselineIds.has(question.id)).toBe(true);
    }

    await page.waitForURL(QUIZ_TAKE_URL, { timeout: 60_000 });

    // Complete the attempt so it does not linger as in-progress and eat the
    // daily practice-quiz quota of parallel specs.
    const answerBox = page.locator('textarea');
    await expect(answerBox).toHaveCount(1);
    await answerBox.fill('QA-323 odpowiedź otwarta.');
    await page.getByRole('button', { name: t('AppQuizPage.submit') }).click();
    await expect(page).toHaveURL(/\/review$/, { timeout: 30_000 });
  });
});
