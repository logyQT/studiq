import { expect, test, type APIResponse, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * EDU-QZ-02 — Dodawanie pytań do quizu (/edu/quizzes/<id>/edit).
 *
 * Case (verbatim → tenant model): with the quiz editor open, add a few questions
 * from the question browser („Dodaj pytania”), drag a question from the list on
 * the right into the quiz, then try to add the same question again. Questions
 * land in the quiz with the default 1 point, already-added questions are
 * marked/hidden in the browser (so they cannot be duplicated), and „Suma
 * punktów” follows every change. The case's legacy account
 * (`teacher-classroom@dev.local`, password `pass`) is never used.
 *
 * Tenant (`content` profile — org + manager/educator/student + default group
 * `G1`, declared in `qa/tests/profiles/EDU-QZ-02.json`), fresh run suffix per
 * independent run:
 *
 *   bun scripts/qa-tenant.ts EDU-QZ-02 --fresh
 *
 * gives `qa-edu-qz-02-<suffix>` (`tenantKey('qa/cases/EDU-QZ-02.md',
 * 'EDU-QZ-02#<suffix>', 'qa-shared')` + `tenantId` for every org/user/group id).
 * The case's prerequisites — a question bank with three questions and one quiz —
 * are built through the product API inside this tenant, idempotently, so a retry
 * against the same tenant does not duplicate them; the quiz is reset to empty
 * before the walk so the run always starts at „0 pytań”. Nothing global is read
 * or written: no admin setting, feature flag, plan, platform stat or singleton
 * row, and no other worker's tenant.
 *
 * Acceptance points (walked on the shared app, worker qa-env-2, before writing):
 * 1. The docked browser is the card titled „Dodaj pytania” (desktop; the same
 *    browser opens as a dialog on narrow viewports); it lists the tenant
 *    questions and the „+” control is `title="Dodaj do quizu"`.
 * 2. Adding a question with „+” renders a row „N. <content>” whose points input
 *    („Punkty za pytanie N”) is `1` and whose unit is „pkt”.
 * 3. Dragging another question from the browser grip into the quiz inserts it,
 *    also with `1` point.
 * 4. Every added question disappears from the browser together with its „+”, so
 *    it cannot be added a second time; once all are added the browser shows
 *    „Nie znaleziono pytań”.
 * 5. The footer reads „N pytań · Suma punktów: N” after each addition, and
 *    „Zapisz” persists the rows (`points: 1`, contiguous `order_index`) so a
 *    reload keeps both the rows and the total.
 */

const CASE = 'EDU-QZ-02';

const BANK_NAME = 'QZ Bank';
const QUIZ_NAME = 'Quiz QZ';
const QUESTION_CONTENTS = ['QZ pytanie A', 'QZ pytanie B', 'QZ pytanie C'] as const;
const [FIRST, SECOND, THIRD] = QUESTION_CONTENTS;
const DEFAULT_POINTS = 1;

/** Polish copy from `EduQuizEditPage` (pl.json), as the product renders it. */
const COPY = {
  editorTitle: 'Edytuj quiz',
  addQuestions: 'Dodaj pytania',
  emptyQuiz: 'Brak pytań',
  emptyQuizDesc: 'Dodaj pytania do tego quizu',
  noQuestionsFound: 'Nie znaleziono pytań',
  addToQuiz: 'Dodaj do quizu',
  save: 'Zapisz',
  saved: 'Zapisano',
  pointsUnit: 'pkt',
} as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface BankListItem {
  id: string;
  name: string;
  organization_id: string | null;
}

interface BankListResult {
  items: BankListItem[];
}

interface QuizListItem {
  id: string;
  name: string;
}

interface QuizDetail {
  id: string;
  name: string;
  description: string | null;
  quiz_questions: Array<{
    question_id: string;
    order_index: number;
    points: number;
    question?: { id: string; content: string };
  }>;
}

interface StoredQuestion {
  id: string;
  content: string;
  bank_id: string;
}

function account(tenant: QaTenant) {
  const user = tenant.users.teacher;
  if (!user) {
    throw new Error(
      `EDU-QZ-02 fixture incomplete: no teacher. Run \`bun scripts/qa-tenant.ts ${CASE} --fresh\``,
    );
  }
  return user;
}

async function expectApi<T>(response: APIResponse, label: string): Promise<T> {
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(response.status(), `${label} → ${response.status()} ${JSON.stringify(body)}`).toBeLessThan(
    300,
  );
  expect(body.success, `${label} response`).toBe(true);
  return body.data;
}

/**
 * The case's question bank. Idempotent so the CI retry budget (`--retries=2`
 * against the tenant seeded once) never creates a second bank.
 */
async function ensureBank(page: Page, tenant: QaTenant): Promise<BankListItem> {
  const list = await expectApi<BankListResult>(
    await page.request.get('/api/v1/questions/banks?limit=100'),
    'GET /api/v1/questions/banks',
  );
  const existing = list.items.find(
    (bank) => bank.name === BANK_NAME && bank.organization_id === tenant.org?.id,
  );
  if (existing) return existing;

  return expectApi<BankListItem>(
    await page.request.post('/api/v1/questions/banks', {
      data: { name: BANK_NAME, description: 'Bank do quizu' },
    }),
    'POST /api/v1/questions/banks',
  );
}

/** The three questions the case chooses from; idempotent for the same reason. */
async function ensureQuestions(page: Page, bankId: string): Promise<StoredQuestion[]> {
  const stored = await expectApi<StoredQuestion[]>(
    await page.request.get(`/api/v1/questions?bankId=${bankId}`),
    'GET /api/v1/questions',
  );
  const questions: StoredQuestion[] = [];
  for (const content of QUESTION_CONTENTS) {
    const existing = stored.find((question) => question.content === content);
    if (existing) {
      questions.push(existing);
      continue;
    }
    questions.push(
      await expectApi<StoredQuestion>(
        await page.request.post('/api/v1/questions', {
          data: { bankId, type: 'open', content },
        }),
        `POST /api/v1/questions (${content})`,
      ),
    );
  }
  return questions;
}

/** The case's quiz, reused across retries on the same tenant. */
async function ensureQuiz(page: Page): Promise<QuizListItem> {
  const quizzes = await expectApi<QuizListItem[]>(
    await page.request.get('/api/v1/teacher/quizzes'),
    'GET /api/v1/teacher/quizzes',
  );
  const existing = quizzes.find((quiz) => quiz.name === QUIZ_NAME);
  if (existing) return existing;

  return expectApi<QuizListItem>(
    await page.request.post('/api/v1/teacher/quizzes', {
      data: { name: QUIZ_NAME, description: 'Quiz do dodawania pytań' },
    }),
    'POST /api/v1/teacher/quizzes',
  );
}

/**
 * A retry against the same tenant must start from the same state: empty the
 * quiz so the empty state and the browser's full list are real again.
 */
async function resetQuiz(page: Page, quiz: QuizListItem): Promise<void> {
  await expectApi<QuizDetail>(
    await page.request.put(`/api/v1/teacher/quizzes/${quiz.id}/bulk`, {
      data: { name: quiz.name, description: null, questions: [] },
    }),
    `PUT /api/v1/teacher/quizzes/${quiz.id}/bulk (reset)`,
  );
}

function browserPanel(page: Page): Locator {
  return page
    .locator('main [data-slot="card"]')
    .filter({ has: page.getByRole('heading', { level: 3, name: COPY.addQuestions, exact: true }) });
}

function browserItem(page: Page, content: string): Locator {
  return browserPanel(page)
    .locator('div.rounded-lg.border')
    .filter({ has: page.getByText(content, { exact: true }) });
}

function quizRows(page: Page): Locator {
  return page.locator('main div.rounded-lg.border.p-3').filter({ hasText: /^\s*\d+\./ });
}

function quizRow(page: Page, content: string): Locator {
  return quizRows(page).filter({ hasText: content });
}

function footer(questions: number, points: number): string {
  // Polish plural: 1 „pytanie”, 2-4 „pytania”, 0 and 5+ „pytań”.
  const noun = questions === 1 ? 'pytanie' : questions >= 2 && questions <= 4 ? 'pytania' : 'pytań';
  return `${questions} ${noun} · Suma punktów: ${points}`;
}

/**
 * dnd-kit needs intermediate `pointermove` events: one jump never exceeds the
 * 8 px `PointerSensor` activation constraint and collision detection only runs
 * on move, so Playwright's `dragTo()` does not work for this editor.
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

test.describe('@case:EDU-QZ-02 @area:EDU @prio:P1 add questions to a quiz', () => {
  test('adds questions with 1 point each, hides added ones and updates the total', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const tenant = loadTenant(CASE);
    console.log(`EDU-QZ-02 tenant key: ${tenant.key}`);
    account(tenant);

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // --- Prerequisites: tenant bank with three questions, one empty quiz ------
    await loginAs(page, tenant, 'teacher', { locale: 'pl' });
    expect(new URL(page.url()).pathname, 'educator lands on /edu').toBe('/edu');

    const bank = await ensureBank(page, tenant);
    expect(bank.organization_id, 'the bank belongs to the tenant organization').toBe(
      tenant.org?.id,
    );
    const questions = await ensureQuestions(page, bank.id);
    expect(
      questions.map((question) => question.content),
      'the bank stores the three case questions',
    ).toEqual([...QUESTION_CONTENTS]);

    const quiz = await ensureQuiz(page);
    await resetQuiz(page, quiz);

    // --- Step 1: open the editor and the question browser --------------------
    await page.goto(`/edu/quizzes/${quiz.id}/edit`);
    await expect(page).toHaveURL(new RegExp(`/edu/quizzes/${quiz.id}/edit$`));
    await expect(
      page.getByRole('heading', { level: 1, name: COPY.editorTitle, exact: true }),
    ).toBeVisible();

    const panel = browserPanel(page);
    await expect(panel, 'the docked „Dodaj pytania” browser').toBeVisible();
    await expect(page.getByText(COPY.emptyQuiz, { exact: true })).toBeVisible();
    await expect(page.getByText(COPY.emptyQuizDesc, { exact: true })).toBeVisible();
    await expect(page.getByText(footer(0, 0), { exact: true })).toBeVisible();

    for (const content of QUESTION_CONTENTS) {
      await expect(browserItem(page, content), `browser offers ${content}`).toHaveCount(1);
    }
    await expect(quizRows(page), 'the quiz starts empty').toHaveCount(0);

    // --- Step 1: add the first question with „+” ------------------------------
    await browserItem(page, FIRST)
      .getByRole('button', { name: COPY.addToQuiz, exact: true })
      .click();

    await expect(quizRows(page), 'one question in the quiz').toHaveCount(1);
    const firstRow = quizRow(page, FIRST);
    await expect(firstRow).toHaveCount(1);
    await expect(firstRow.locator('div.flex-1')).toContainText(new RegExp(`^1\\.\\s*${FIRST}`));
    await expect(firstRow.locator('input[type="number"]')).toHaveValue(String(DEFAULT_POINTS));
    await expect(firstRow).toContainText(COPY.pointsUnit);
    await expect(page.getByText(footer(1, DEFAULT_POINTS), { exact: true })).toBeVisible();

    // Expected result: the added question is hidden in the browser (no duplicate).
    await expect(panel.getByText(FIRST, { exact: true }), 'added question hidden').toHaveCount(0);
    await expect(browserItem(page, FIRST), 'no browser card for the added question').toHaveCount(0);
    await expect(browserItem(page, SECOND), 'browser still offers the second question').toHaveCount(
      1,
    );
    await expect(browserItem(page, THIRD), 'browser still offers the third question').toHaveCount(
      1,
    );

    // --- Step 2: drag the second question from the browser into the quiz -----
    await dragOnto(
      page,
      browserItem(page, SECOND).locator('button[aria-roledescription="draggable"]'),
      firstRow,
    );

    await expect(quizRows(page), 'two questions in the quiz').toHaveCount(2);
    await expect(quizRow(page, SECOND), 'the dragged question is in the quiz').toHaveCount(1);
    for (const content of [FIRST, SECOND]) {
      await expect(
        quizRow(page, content).locator('input[type="number"]'),
        `${content} keeps the default 1 point`,
      ).toHaveValue(String(DEFAULT_POINTS));
    }
    await expect(page.getByText(footer(2, DEFAULT_POINTS * 2), { exact: true })).toBeVisible();
    await expect(panel.getByText(SECOND, { exact: true }), 'dragged question hidden').toHaveCount(
      0,
    );
    await expect(browserItem(page, SECOND), 'no browser card for the dragged question').toHaveCount(
      0,
    );

    // --- Step 3: the same question cannot be added again ----------------------
    await expect(
      browserItem(page, FIRST).getByRole('button', { name: COPY.addToQuiz }),
    ).toHaveCount(0);
    await expect(
      browserItem(page, SECOND).getByRole('button', { name: COPY.addToQuiz }),
    ).toHaveCount(0);
    await expect(
      browserPanel(page).locator('button[title="Dodaj do quizu"]'),
      'only the not-yet-added question keeps its „+”',
    ).toHaveCount(1);

    // Add the remaining question; the browser has nothing left to offer.
    await browserItem(page, THIRD)
      .getByRole('button', { name: COPY.addToQuiz, exact: true })
      .click();
    await expect(quizRows(page), 'all three questions in the quiz').toHaveCount(3);
    await expect(quizRow(page, THIRD)).toHaveCount(1);
    await expect(page.getByText(COPY.noQuestionsFound, { exact: true })).toBeVisible();
    await expect(page.getByText(footer(3, DEFAULT_POINTS * 3), { exact: true })).toBeVisible();

    // --- Expected result: save and reload keep the rows and the total --------
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/v1/teacher/quizzes/${quiz.id}/bulk`) &&
        response.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: COPY.save, exact: true }).click();
    expect((await saved).status(), 'bulk save succeeds').toBe(200);
    await expect(page.getByText(COPY.saved, { exact: true }).first()).toBeVisible();

    await page.reload();
    await expect(quizRows(page), 'the saved questions survive a reload').toHaveCount(3);
    for (const content of QUESTION_CONTENTS) {
      await expect(quizRow(page, content), `${content} survives a reload`).toHaveCount(1);
      await expect(
        quizRow(page, content).locator('input[type="number"]'),
        `${content} still has 1 point after reload`,
      ).toHaveValue(String(DEFAULT_POINTS));
    }
    await expect(page.getByText(footer(3, DEFAULT_POINTS * 3), { exact: true })).toBeVisible();
    await expect(page.getByText(COPY.noQuestionsFound, { exact: true })).toBeVisible();

    // --- Stored state: three unique questions, 1 point each, contiguous order -
    const detail = await expectApi<QuizDetail>(
      await page.request.get(`/api/v1/teacher/quizzes/${quiz.id}`),
      'GET /api/v1/teacher/quizzes/<id>',
    );
    expect(detail.quiz_questions, 'exactly three quiz questions').toHaveLength(3);
    expect(
      detail.quiz_questions.map((row) => row.question_id).sort(),
      'the quiz stores each case question exactly once',
    ).toEqual(questions.map((question) => question.id).sort());
    for (const row of detail.quiz_questions) {
      expect(row.points, 'stored points').toBe(DEFAULT_POINTS);
    }
    expect(
      detail.quiz_questions.map((row) => row.order_index).sort((a, b) => a - b),
      'stored order is contiguous',
    ).toEqual([0, 1, 2]);

    expect(pageErrors, 'uncaught page errors during the walk').toEqual([]);
  });
});
