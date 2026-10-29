import { expect, test, type Page } from '@playwright/test';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

/**
 * EDU-QZ-01 — creating a quiz („Utworzenie quizu”).
 *
 * Case steps: click „Nowy quiz”, type the name „Quiz próbny” and a description, click
 * „Utwórz quiz”; then leave the name empty and try to create.
 * Expected result: the new quiz opens in its editor (`/edu/quizzes/<id>/edit`) and the
 * „Utwórz quiz” button is inactive while the name is empty.
 *
 * Tenant (deterministic, `content` profile, one fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts EDU-QZ-01 --fresh
 *
 * gives the org `qa-edu-qz-01-<suffix>` with a manager, an educator and a student, plus
 * the default group `G1`; the spec logs in as `tenant.users.teacher` with the tenant org
 * as the active org. The case's legacy prerequisite account (`teacher-classroom@dev.local`,
 * password `pass`) is never used. Nothing global is read or written: no admin setting,
 * feature flag, plan, platform stat or singleton row, and no other worker's tenant.
 *
 * Retry safety (CI seeds once and retries against the same tenant): the case's
 * „Quiz próbny” carries the run suffix, and every assertion addresses the quiz by the id
 * the create response returns — a re-run simply adds another, differently named quiz.
 *
 * Acceptance points (confirmed on the shared app during the walk):
 * 1. `/edu/quizzes` offers „Nowy quiz”, which opens the page `/edu/quizzes/new` with
 *    „Nazwa *” (`#name`), „Opis” (`#description`), „Anuluj” and „Utwórz quiz”.
 * 2. A valid name + description -> `POST /api/v1/teacher/quizzes` answers 201, the app
 *    routes to `/edu/quizzes/<id>/edit`, and the editor („Edytuj quiz”) shows both fields
 *    prefilled with the empty state „Brak pytań” / „Dodaj pytania do tego quizu”.
 * 3. The created quiz is listed on `/edu/quizzes` with its description and „0 pytań”.
 * 4. With an empty (or whitespace-only) name „Utwórz quiz” is disabled and neither a click
 *    nor Enter creates anything; the server rejects a blank name with 422 as well.
 * 5. „Anuluj” leaves the form without creating a quiz.
 */

const CASE = 'EDU-QZ-01';

/** How long a run may take: one quiz through the UI, two page walks. */
const RUN_TIMEOUT = 90_000;

const QUIZZES_URL = '/api/v1/teacher/quizzes';

/** Polish copy from `EduQuizzesPage` / `EduQuizNewPage` / `EduQuizEditPage` (pl.json). */
const COPY = {
  listTitle: 'Quizy',
  newQuiz: 'Nowy quiz',
  newQuizTitle: 'Nowy quiz',
  nameLabel: 'Nazwa *',
  descriptionLabel: 'Opis',
  create: 'Utwórz quiz',
  cancel: 'Anuluj',
  editorTitle: 'Edytuj quiz',
  noQuestions: 'Brak pytań',
  noQuestionsDesc: 'Dodaj pytania do tego quizu',
  zeroQuestions: '0 pytań',
} as const;

/** The case's quiz name, made unique per run so a retry never shares a card. */
const RUN_SUFFIX = process.env.QA_RUN_SUFFIX ?? Date.now().toString(36);
const QUIZ_NAME = `Quiz próbny ${RUN_SUFFIX}`;
const QUIZ_DESCRIPTION = 'Krótki opis quizu próbnego';

interface QuizRow {
  id: string;
  name: string;
  description: string | null;
  organization_id: string;
  created_by: string;
  quiz_questions: { count: number }[];
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

/** The quiz collection the screen renders (`GET /api/v1/teacher/quizzes`). */
async function listQuizzes(page: Page): Promise<QuizRow[]> {
  const response = await page.request.get(QUIZZES_URL);
  expect(response.status(), `GET ${QUIZZES_URL} → ${response.status()}`).toBe(200);
  const body = (await response.json()) as ApiEnvelope<QuizRow[]>;
  expect(body.success, `GET ${QUIZZES_URL} success flag`).toBe(true);
  return body.data;
}

/** The editor's name/description fields, addressed by the ids the form uses. */
function editorField(page: Page, id: 'name' | 'description') {
  return page.locator(`#${id}`);
}

test.describe('@case:EDU-QZ-01 @area:EDU @prio:P2 create a quiz', () => {
  test('creates a quiz from the name and description and opens its editor', async ({ page }) => {
    test.setTimeout(RUN_TIMEOUT);
    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    if (!tenant.org || !tenant.users.teacher) {
      throw new Error(`${CASE} needs the content tenant profile (org and educator)`);
    }

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu(\/|$)/ });
    expect(new URL(page.url()).pathname, 'the educator lands on /edu').toBe('/edu');

    // --- Step 1: „Nowy quiz” -------------------------------------------------
    await page.goto('/edu/quizzes');
    await expect(page).toHaveURL(/\/edu\/quizzes$/);
    await expect(page.getByRole('heading', { name: COPY.listTitle, exact: true })).toBeVisible();

    const newQuizLink = page.getByRole('link', { name: COPY.newQuiz, exact: true });
    await expect(newQuizLink).toHaveCount(1);
    await newQuizLink.click();
    await expect(page).toHaveURL(/\/edu\/quizzes\/new$/);
    await expect(page.getByRole('heading', { name: COPY.newQuizTitle, exact: true })).toBeVisible();
    await expect(page.getByText(COPY.nameLabel, { exact: true })).toBeVisible();
    await expect(page.getByText(COPY.descriptionLabel, { exact: true })).toBeVisible();

    // --- Step 2: name + description → „Utwórz quiz” --------------------------
    const nameInput = editorField(page, 'name');
    const descriptionInput = editorField(page, 'description');
    await expect(nameInput).toHaveValue('');
    await expect(descriptionInput).toHaveValue('');
    await nameInput.fill(QUIZ_NAME);
    await descriptionInput.fill(QUIZ_DESCRIPTION);

    const createButton = page.getByRole('button', { name: COPY.create, exact: true });
    await expect(createButton, 'a filled name enables the create action').toBeEnabled();

    const [created] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith(QUIZZES_URL) && response.request().method() === 'POST',
      ),
      createButton.click(),
    ]);
    const createdBody = (await created.json()) as ApiEnvelope<QuizRow>;
    expect(
      created.status(),
      `POST ${QUIZZES_URL} → ${created.status()} ${JSON.stringify(createdBody)}`,
    ).toBe(201);
    expect(createdBody.success, `POST ${QUIZZES_URL} success flag`).toBe(true);

    const quiz = createdBody.data;
    expect(quiz.name, 'the typed name is stored').toBe(QUIZ_NAME);
    expect(quiz.description, 'the description is stored').toBe(QUIZ_DESCRIPTION);
    expect(quiz.organization_id, 'the quiz belongs to the tenant organization').toBe(tenant.org.id);

    // The editor opens for the quiz that was just created.
    await expect(page).toHaveURL(new RegExp(`/edu/quizzes/${quiz.id}/edit$`));
    await expect(page.getByRole('heading', { name: COPY.editorTitle, exact: true })).toBeVisible();
    await expect(editorField(page, 'name')).toHaveValue(QUIZ_NAME);
    await expect(editorField(page, 'description')).toHaveValue(QUIZ_DESCRIPTION);
    await expect(page.getByText(COPY.noQuestions, { exact: true })).toBeVisible();
    await expect(page.getByText(COPY.noQuestionsDesc, { exact: true })).toBeVisible();

    // The same quiz, read back through the API.
    const detail = await page.request.get(`${QUIZZES_URL}/${quiz.id}`);
    expect(detail.status(), 'the created quiz is readable by its author').toBe(200);
    const detailBody = (await detail.json()) as ApiEnvelope<QuizRow>;
    expect(detailBody.data.name).toBe(QUIZ_NAME);
    expect(detailBody.data.description).toBe(QUIZ_DESCRIPTION);
    expect(detailBody.data.quiz_questions, 'a new quiz starts without questions').toEqual([]);

    // --- The list shows the new quiz ----------------------------------------
    await page.goto('/edu/quizzes');
    const card = page.locator(`a[href="/edu/quizzes/${quiz.id}"]`);
    await expect(card, 'the created quiz is listed').toHaveCount(1);
    await expect(card.getByText(QUIZ_NAME, { exact: true })).toBeVisible();
    await expect(card.getByText(QUIZ_DESCRIPTION, { exact: true })).toBeVisible();
    await expect(card.getByText(COPY.zeroQuestions, { exact: true })).toBeVisible();

    expect(pageErrors, 'uncaught page errors during the walk').toEqual([]);
  });

  test('keeps „Utwórz quiz” disabled while the name is empty or blank', async ({ page }) => {
    test.setTimeout(RUN_TIMEOUT);
    const tenant = loadTenant(CASE);
    if (!tenant.org || !tenant.users.teacher) {
      throw new Error(`${CASE} needs the content tenant profile (org and educator)`);
    }

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu(\/|$)/ });

    await page.goto('/edu/quizzes/new');
    await expect(page).toHaveURL(/\/edu\/quizzes\/new$/);

    const nameInput = editorField(page, 'name');
    const createButton = page.getByRole('button', { name: COPY.create, exact: true });
    const quizzesBefore = await listQuizzes(page);

    // --- Step 3: empty name -------------------------------------------------
    await expect(nameInput).toHaveValue('');
    await expect(createButton, 'no name → no create action').toBeDisabled();

    // Enter cannot bypass the disabled button either.
    await nameInput.press('Enter');
    await expect(page).toHaveURL(/\/edu\/quizzes\/new$/);
    expect((await listQuizzes(page)).length, 'Enter with an empty name creates nothing').toBe(
      quizzesBefore.length,
    );

    // --- Blank (whitespace-only) name ---------------------------------------
    await nameInput.fill('   ');
    await expect(createButton, 'a blank name is not a name').toBeDisabled();
    await nameInput.press('Enter');
    await expect(page).toHaveURL(/\/edu\/quizzes\/new$/);
    expect((await listQuizzes(page)).length, 'a blank name creates nothing').toBe(
      quizzesBefore.length,
    );

    // A real character enables the action; clearing it disables it again.
    await nameInput.fill('Q');
    await expect(createButton).toBeEnabled();
    await nameInput.fill('');
    await expect(createButton).toBeDisabled();

    // The API agrees: a blank name is a validation error, not an empty quiz.
    const blank = await page.request.post(QUIZZES_URL, { data: { name: '   ' } });
    expect(blank.status(), 'the server rejects a blank quiz name').toBe(422);
    const blankBody = (await blank.json()) as {
      success: boolean;
      error: string;
      details?: unknown;
      issues?: unknown;
    };
    expect(blankBody.success).toBe(false);
    expect(blankBody.error).toBe('UNPROCESSABLE_ENTITY');

    // „Anuluj” leaves the form; nothing was created by the attempts above.
    await page.getByRole('button', { name: COPY.cancel, exact: true }).click();
    await expect(page).toHaveURL(/\/edu\/quizzes$/);
    expect((await listQuizzes(page)).length, 'cancelling creates nothing').toBe(
      quizzesBefore.length,
    );

    expect(pageErrors, 'uncaught page errors during the walk').toEqual([]);
  });
});
