import { expect, type Locator, type Page, test } from '@playwright/test';
import { t } from '#test/e2e/utils';

const email = 'teacher-classroom@dev.local';
const password = 'pass';

async function loginTeacher(page: Page) {
  await page.goto('/login');
  await page.getByLabel(t('LoginPage.email_label')).fill(email);
  await page.getByLabel(t('LoginPage.password_label')).fill(password);
  await page.getByRole('button', { name: t('LoginPage.login_button') }).click();
  await page.waitForURL(/\/edu/);
}

/** Creates an empty quiz through the API so the test never depends on seed state. */
async function createEmptyQuiz(page: Page): Promise<string> {
  const name = `QA160 dnd ${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  const response = await page.request.post('/api/v1/teacher/quizzes', {
    data: { name, description: 'e2e drag & drop' },
  });
  expect(response.status()).toBe(201);
  const body = await response.json();
  return body.data.id as string;
}

/**
 * dnd-kit needs intermediate `pointermove` events: one jump never exceeds the 8 px
 * `PointerSensor` activation constraint and collision detection only runs on move,
 * so Playwright's `dragTo()` does not work for this editor.
 */
async function dragOnto(page: Page, source: Locator, target: Locator) {
  await source.scrollIntoViewIfNeeded();
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('drag source or target is not visible');

  const startX = from.x + from.width / 2;
  const startY = from.y + from.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 12, startY + 12, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 15 });
  await page.mouse.up();
}

const editorPanel = (page: Page) =>
  page
    .locator('div.w-96')
    .filter({ hasText: t('EduQuizEditPage.add_questions') })
    .first();

const quizRows = (page: Page) =>
  page.locator('div.rounded-lg.border.p-3').filter({ hasText: /^\s*\d+\./ });

const footer = (page: Page) => page.getByText(/^\d+ (pytanie|pytania|pytań) · Suma punktów: \d+$/);

test.describe('EDU quiz editor drag & drop (#160)', () => {
  test('dropping a question onto an empty quiz adds the first question', async ({ page }) => {
    await loginTeacher(page);
    const quizId = await createEmptyQuiz(page);

    try {
      await page.goto(`/edu/quizzes/${quizId}/edit`);

      const emptyState = page.getByText(t('EduQuizEditPage.no_questions')).first();
      await expect(emptyState).toBeVisible();
      await expect(footer(page)).toHaveText('0 pytań · Suma punktów: 0');

      const grip = editorPanel(page).locator('button.cursor-grab').first();
      await expect(grip).toBeVisible();

      await dragOnto(page, grip, emptyState);

      await expect(quizRows(page)).toHaveCount(1);
      await expect(quizRows(page).first()).toContainText('1.');
      await expect(footer(page)).toHaveText('1 pytanie · Suma punktów: 1');

      // Persist explicitly (autosave is debounced by 5 s) and prove it survives a reload.
      const saved = page.waitForResponse(
        (response) =>
          response.url().includes(`/api/v1/teacher/quizzes/${quizId}/bulk`) &&
          response.request().method() === 'PUT',
      );
      await page.getByRole('button', { name: t('EduQuizEditPage.save') }).click();
      expect((await saved).status()).toBe(200);

      await page.reload();

      await expect(quizRows(page)).toHaveCount(1);
      await expect(footer(page)).toHaveText('1 pytanie · Suma punktów: 1');
    } finally {
      await page.request.delete(`/api/v1/teacher/quizzes/${quizId}`);
    }
  });

  test('dropping a question onto an existing row still inserts at that position', async ({
    page,
  }) => {
    await loginTeacher(page);

    const questionsResponse = await page.request.get('/api/v1/questions');
    expect(questionsResponse.status()).toBe(200);
    const bank = (await questionsResponse.json()).data as Array<{ id: string }>;
    expect(bank.length).toBeGreaterThan(1);

    const quizId = await createEmptyQuiz(page);

    try {
      // Start from a quiz with one question so the row droppables exist.
      const seeded = await page.request.put(`/api/v1/teacher/quizzes/${quizId}/bulk`, {
        data: {
          name: `QA160 non-empty ${Date.now()}`,
          description: null,
          questions: [{ question_id: bank[1].id, order_index: 0, points: 1 }],
        },
      });
      expect(seeded.status()).toBe(200);

      await page.goto(`/edu/quizzes/${quizId}/edit`);
      await expect(quizRows(page)).toHaveCount(1);
      await expect(footer(page)).toHaveText('1 pytanie · Suma punktów: 1');

      const panel = editorPanel(page);
      const firstItem = panel.locator('div.rounded-lg.border.p-3').first();
      const draggedContent = (await firstItem.locator('p').first().innerText()).trim();

      await dragOnto(page, firstItem.locator('button.cursor-grab'), quizRows(page).first());

      await expect(quizRows(page)).toHaveCount(2);
      await expect(quizRows(page).first()).toContainText(draggedContent);
      await expect(footer(page)).toHaveText('2 pytania · Suma punktów: 2');
    } finally {
      await page.request.delete(`/api/v1/teacher/quizzes/${quizId}`);
    }
  });
});
