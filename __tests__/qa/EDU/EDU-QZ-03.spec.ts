import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * EDU-QZ-03 — reordering questions and editing their points in the quiz editor
 * (`/edu/quizzes/:id/edit`).
 *
 * Prerequisite (reconciled with the tenant seeder): „quiz z ≥ 3 pytaniami”. The
 * legacy account (`teacher1@dev.local`, password `pass`) is never used.
 *
 *   bun scripts/qa-tenant.ts EDU-QZ-03 --fresh
 *
 * Tenant: the case's own `content` tenant (`__tests__/qa/profiles/EDU-QZ-03.json`) —
 * organization `qa-edu-qz-03-<suffix>` with a manager, the teacher and the student
 * plus the default group `G1`. The spec creates the quiz itself (bank + three
 * questions + quiz) through the product API with a per-execution tag, so repeated
 * runs against the same tenant stay independent. Nothing global (admin setting,
 * feature flag, plan, platform stat, singleton row) and no other tenant is
 * touched.
 *
 * Acceptance points (walked on the shared app, worker qa-env-7, Polish UI):
 * 1. Dragging the third question above the first reorders the list immediately —
 *    before any save request — and leaves the „Suma punktów” untouched.
 * 2. Typing 5 into one question's points input updates „Suma punktów” immediately
 *    (1+1+1 → 1+5+1) and shows „Niezapisane zmiany”.
 * 3. „Zapisz” persists order + points and answers with the „Zapisano” toast; the
 *    „Niezapisane zmiany” indicator disappears.
 * 4. Deleting a question removes it and its points from the sum immediately and
 *    marks the quiz dirty again; the 5-second autosave then persists the new
 *    question list and shows „Zapisano”.
 * 5. After a reload the stored order, points and total are exactly what the screen
 *    showed — no unsaved state.
 */

const CASE = 'EDU-QZ-03';

/** Polish copy the case quotes, as the current product renders it. */
const COPY = {
  title: 'Edytuj quiz',
  saved: 'Zapisano',
  unsaved: 'Niezapisane zmiany',
  save: 'Zapisz',
  totalPoints: 'Suma punktów',
} as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface QuizQuestionRow {
  question_id: string;
  order_index: number;
  points: number;
  question?: { id: string; content: string; type: string };
}

interface QuizDetail {
  id: string;
  name: string;
  description: string | null;
  quiz_questions: QuizQuestionRow[];
}

async function postJson<T>(
  page: Page,
  url: string,
  data: unknown,
): Promise<{ status: number; body: ApiEnvelope<T> }> {
  const response = await page.request.post(url, { data });
  const body = (await response.json()) as ApiEnvelope<T>;
  return { status: response.status(), body };
}

async function getData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.ok(), `GET ${url} → ${response.status()} ${await response.text()}`).toBe(true);
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data;
}

/** Create the case's own bank, its three questions and the quiz holding them. */
async function createQuiz(
  page: Page,
  tag: string,
): Promise<{ id: string; contents: [string, string, string] }> {
  const bank = await postJson<{ id: string }>(page, '/api/v1/questions/banks', {
    name: `EDU-QZ-03 bank ${tag}`,
  });
  expect(bank.status, 'POST /api/v1/questions/banks').toBe(201);

  const contents: [string, string, string] = [
    `EDU-QZ-03 ${tag} pytanie A`,
    `EDU-QZ-03 ${tag} pytanie B`,
    `EDU-QZ-03 ${tag} pytanie C`,
  ];
  const questionIds: string[] = [];
  for (const content of contents) {
    const question = await postJson<{ id: string }>(page, '/api/v1/questions', {
      bankId: bank.body.data.id,
      type: 'mcq',
      content,
      answers: [
        { content: 'tak', isCorrect: true, orderIndex: 0 },
        { content: 'nie', isCorrect: false, orderIndex: 1 },
      ],
    });
    expect(question.status, `POST /api/v1/questions (${content})`).toBe(201);
    questionIds.push(question.body.data.id);
  }

  const quiz = await postJson<{ id: string }>(page, '/api/v1/teacher/quizzes', {
    name: `EDU-QZ-03 quiz ${tag}`,
    description: 'kolejność i punkty',
  });
  expect(quiz.status, 'POST /api/v1/teacher/quizzes').toBe(201);

  const added = await postJson<unknown>(
    page,
    `/api/v1/teacher/quizzes/${quiz.body.data.id}/questions`,
    { questionIds },
  );
  expect(added.status, 'POST /api/v1/teacher/quizzes/:id/questions').toBe(200);

  return { id: quiz.body.data.id, contents };
}

/** The question rows of the editor (the cards that own a points input). */
function questionRows(page: Page): Locator {
  return page
    .locator('main div.rounded-lg.border')
    .filter({ has: page.locator('input[type="number"]') });
}

/** One question row, addressed by its content so no index ever drifts. */
function rowFor(page: Page, content: string): Locator {
  return questionRows(page).filter({ hasText: content });
}

/** The rendered order, read from the numbered list („1.” prefix stripped). */
async function readOrder(page: Page): Promise<string[]> {
  const rows = await questionRows(page).allInnerTexts();
  return rows.map((text) =>
    text
      .split('\n')[0]
      .replace(/^\d+\.\s*/, '')
      .trim(),
  );
}

/** The sticky summary bar: „<n> pytania · Suma punktów: <sum>”. */
function summaryBar(page: Page): Locator {
  return page.getByText(/^\d+ pytani[ae] · Suma punktów: \d+$/);
}

/** The amber „Niezapisane zmiany” indicator next to the summary. */
function unsavedIndicator(page: Page): Locator {
  return page.getByText(COPY.unsaved, { exact: true });
}

/** Sonner toast with the „Zapisano” confirmation. */
function savedToast(page: Page): Locator {
  return page.locator('[data-sonner-toast]').filter({ hasText: COPY.saved });
}

/** Persisted state, read back through the same API the editor loads. */
async function storedQuiz(page: Page, quizId: string): Promise<QuizQuestionRow[]> {
  const quiz = await getData<QuizDetail>(page, `/api/v1/teacher/quizzes/${quizId}`);
  return [...quiz.quiz_questions].sort((a, b) => a.order_index - b.order_index);
}

/**
 * Drag a question's grip handle above another question. dnd-kit's `PointerSensor`
 * only activates after 8 px, so the move is a real sequence of pointer moves — the
 * same gesture a teacher performs, not a synthetic drop event.
 */
async function dragAbove(page: Page, dragged: string, target: string): Promise<void> {
  const handle = rowFor(page, dragged).locator('button').first();
  const handleBox = await handle.boundingBox();
  const targetBox = await rowFor(page, target).boundingBox();
  if (!handleBox || !targetBox) {
    throw new Error(`EDU-QZ-03: cannot measure the drag handles (${dragged} → ${target})`);
  }

  const x = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;
  const endY = targetBox.y + Math.min(12, targetBox.height / 2);

  await page.mouse.move(x, startY);
  await page.mouse.down();
  const steps = 12;
  for (let step = 1; step <= steps; step++) {
    await page.mouse.move(x, startY + ((endY - startY) * step) / steps);
    await page.waitForTimeout(25);
  }
  await page.mouse.up();
}

test.describe('@case:EDU-QZ-03 @area:EDU @prio:P2 quiz question order and points', () => {
  test('reorders, repoints and removes a question, keeping the total and the saved state in step', async ({
    page,
  }) => {
    test.setTimeout(150_000);

    const pageErrors: string[] = [];
    const failedRequests: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('response', (response) => {
      if (response.status() >= 400 && response.url().includes('/api/v1/')) {
        failedRequests.push(`${response.status()} ${new URL(response.url()).pathname}`);
      }
    });

    const tenant: QaTenant = loadTenant(CASE);
    const teacher = tenant.users.teacher;
    expect(teacher, 'the tenant seeds the teacher').toBeTruthy();

    // Every execution builds its own quiz, so `--repeat-each` on one seeded tenant
    // never edits a previous run's content.
    const tag = `${tenant.runSuffix ?? 'stable'}-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;

    await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu/ });
    expect(new URL(page.url()).pathname, 'the educator lands on /edu').toBe('/edu');

    const { id: quizId, contents } = await createQuiz(page, tag);
    const [first, second, third] = contents;

    // ── Prerequisite state: three questions, one point each ─────────────────
    await page.goto(`/edu/quizzes/${quizId}/edit`);
    await expect(page).toHaveURL(new RegExp(`/edu/quizzes/${quizId}/edit$`));
    await expect(page.getByRole('heading', { name: COPY.title, exact: true })).toBeVisible();

    await expect
      .poll(() => readOrder(page), { message: 'initial question order' })
      .toEqual([first, second, third]);
    await expect(summaryBar(page), 'initial total').toHaveText(
      `3 pytania · ${COPY.totalPoints}: 3`,
    );
    await expect(unsavedIndicator(page), 'a freshly loaded quiz is clean').toHaveCount(0);

    // Track the editor's own saves: the case requires the reorder to be visible
    // *before* anything is persisted („Kolejność zmienia się natychmiast”).
    const bulkSaves: string[] = [];
    page.on('request', (request) => {
      if (
        request.method() === 'PUT' &&
        /\/api\/v1\/teacher\/quizzes\/[^/]+\/bulk$/.test(new URL(request.url()).pathname)
      ) {
        bulkSaves.push(request.postData() ?? '');
      }
    });

    // ── Step 1: drag the third question above the first ─────────────────────
    await dragAbove(page, third, first);

    await expect
      .poll(() => readOrder(page), { message: 'order after the drag' })
      .toEqual([third, first, second]);
    expect(bulkSaves, 'the reorder renders before any save request').toEqual([]);
    await expect(unsavedIndicator(page), 'the drag marks the quiz dirty').toBeVisible();
    await expect(summaryBar(page), 'reordering does not change the total').toHaveText(
      `3 pytania · ${COPY.totalPoints}: 3`,
    );

    // ── Step 2: set one question to 5 points ────────────────────────────────
    const pointsInput = rowFor(page, first).locator('input[type="number"]');
    await expect(pointsInput, 'the points input is labelled per position').toHaveAttribute(
      'aria-label',
      'Punkty za pytanie 2',
    );
    await pointsInput.fill('5');
    await expect(pointsInput).toHaveValue('5');

    await expect(summaryBar(page), 'the total follows the new points immediately').toHaveText(
      `3 pytania · ${COPY.totalPoints}: 7`,
    );
    await expect(unsavedIndicator(page), 'the points change is unsaved').toBeVisible();
    expect(bulkSaves, 'the new total renders before the save request').toEqual([]);

    // ── „Zapisz” persists order + points ────────────────────────────────────
    const manualSave = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/v1/teacher/quizzes/${quizId}/bulk` &&
        response.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: COPY.save, exact: true }).click();
    expect((await manualSave).status(), 'PUT /api/v1/teacher/quizzes/:id/bulk').toBe(200);

    await expect(savedToast(page), 'the manual save confirms with „Zapisano”').toBeVisible();
    await expect(unsavedIndicator(page), 'the manual save clears the dirty state').toHaveCount(0);

    const afterSave = await storedQuiz(page, quizId);
    expect(
      afterSave.map((row) => row.question?.content),
      'the stored order is the dragged order',
    ).toEqual([third, first, second]);
    expect(
      afterSave.map((row) => row.points),
      'the stored points are the edited points',
    ).toEqual([1, 5, 1]);

    // ── Step 3: delete the question that holds 5 points ─────────────────────
    const autosave = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/v1/teacher/quizzes/${quizId}/bulk` &&
        response.request().method() === 'PUT',
      { timeout: 30_000 },
    );
    await rowFor(page, first).locator('button').last().click({ timeout: 10_000 });

    await expect
      .poll(() => readOrder(page), { message: 'order after the delete' })
      .toEqual([third, second]);
    await expect(summaryBar(page), 'the deleted question leaves the total').toHaveText(
      `2 pytania · ${COPY.totalPoints}: 2`,
    );
    await expect(unsavedIndicator(page), 'the delete marks the quiz dirty').toBeVisible();

    // The autosave debounce is 5 s; it persists the new list and confirms itself.
    expect((await autosave).status(), 'the autosave PUT').toBe(200);
    await expect(savedToast(page), 'the autosave confirms with „Zapisano”').toBeVisible();
    await expect(unsavedIndicator(page), 'the autosave clears the dirty state').toHaveCount(0);

    const afterAutosave = await storedQuiz(page, quizId);
    expect(
      afterAutosave.map((row) => row.question?.content),
      'the stored list has lost the deleted question',
    ).toEqual([third, second]);

    // ── The reload shows exactly what was saved ─────────────────────────────
    await page.reload();
    await expect(page.getByRole('heading', { name: COPY.title, exact: true })).toBeVisible();
    await expect
      .poll(() => readOrder(page), { message: 'order after the reload' })
      .toEqual([third, second]);
    await expect(summaryBar(page), 'the reloaded total').toHaveText(
      `2 pytania · ${COPY.totalPoints}: 2`,
    );
    await expect(
      questionRows(page).nth(0).locator('input[type="number"]'),
      'the surviving first question keeps its points',
    ).toHaveValue('1');
    await expect(
      questionRows(page).nth(1).locator('input[type="number"]'),
      'the surviving second question keeps its points',
    ).toHaveValue('1');
    await expect(unsavedIndicator(page), 'a reloaded quiz is clean').toHaveCount(0);

    expect(failedRequests, 'no API request may fail during the walk').toEqual([]);
    expect(pageErrors, 'uncaught page errors during the walk').toEqual([]);
  });
});
