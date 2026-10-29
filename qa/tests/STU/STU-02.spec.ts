import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

/**
 * STU-02 — Checklista „Pierwsze kroki” (student, `/app`).
 *
 * Case steps: read the „Pierwsze kroki” card, then complete the four steps one by
 * one — create a deck, add a flashcard, take a quiz, review due cards — and come
 * back to `/app` after each of them.
 *
 * Tenant (deterministic `content` profile, a fresh run suffix for every
 * independent run):
 *
 *   bun scripts/qa-tenant.ts STU-02 --fresh
 *
 * gives the org `qa-stu-02-<suffix>` with its manager/teacher and the `student`
 * account this case signs in as, all derived from
 * `tenantKey('qa/cases/STU-02.md', 'STU-02#<suffix>', 'qa-shared')` +
 * `tenantId`. The seeded student has no content at all, which is the case's
 * prerequisite. The spec builds its own deck, card, question and quiz attempt
 * inside that tenant, through the student's own session — nothing global
 * (settings, feature flags, plan catalogue, platform stats) and no other
 * worker's tenant is read or written.
 *
 * Acceptance points (walked on the shared app :3010 before writing the spec):
 * 1. The card opens with „Pierwsze kroki” + „Wykonaj te kroki, aby rozpocząć
 *    naukę” and the four items, in the case's order, none of them done:
 *    „Utwórz swoją pierwszą talię”, „Dodaj fiszki do talii”, „Rozwiąż swój
 *    pierwszy quiz”, „Powtórz zaległe fiszki”.
 * 2. A completed step is marked in the card (green check bubble + struck-through
 *    label) and only that step — the card reflects the real stats payload, which
 *    the spec also reads from `/api/v1/stats/student` after every step.
 * 3. Creating a deck marks step 1; adding a flashcard marks step 2; submitting a
 *    practice quiz marks step 3; rating a card in a learn session marks step 4.
 * 4. Once all four are done the card switches to „Gotowe!” + „Wykonałeś
 *    wszystkie kroki. Możesz ukryć tę kartę.”, and the X hides it for good
 *    (`localStorage` + a reload).
 *
 * The test asserts the intended behavior only; there is no expected-failure
 * branch.
 */

const CASE = 'STU-02';

const CHECKLIST_COPY = {
  title: 'Pierwsze kroki',
  description: 'Wykonaj te kroki, aby rozpocząć naukę',
  allDoneTitle: 'Gotowe!',
  allDoneDescription: 'Wykonałeś wszystkie kroki. Możesz ukryć tę kartę.',
  dismissLabel: 'Ukryj listę pierwszych kroków',
} as const;

const STEPS = [
  'Utwórz swoją pierwszą talię',
  'Dodaj fiszki do talii',
  'Rozwiąż swój pierwszy quiz',
  'Powtórz zaległe fiszki',
] as const;

const DECK_DESCRIPTION = 'Talia założona przez STU-02';
const CARD_FRONT = 'STU-02 pytanie';
const CARD_BACK = 'STU-02 odpowiedź';
const QUIZ_CONTENT = 'STU-02 quiz pytanie?';
const QUIZ_CORRECT = 'Poprawna odpowiedź STU-02';
const QUIZ_WRONG = 'Niepoprawna odpowiedź STU-02';

interface Envelope<T> {
  success: boolean;
  data?: T;
}

interface DeckItem {
  id: string;
  name: string;
  description: string | null;
}

interface StudentStats {
  totalDecks: number;
  totalFlashcards: number;
  totalQuizzes: number;
  flashcardsPracticed: number;
}

/** The card that owns the checklist (its items are unique on the dashboard). */
function checklist(page: Page): Locator {
  return page.locator('[data-slot="card"]').filter({ hasText: STEPS[0] });
}

/** One checklist row by its label. */
function checklistStep(page: Page, label: string): Locator {
  return checklist(page).locator('li').filter({ hasText: label });
}

/** The label span of a row (the bubble and the chevron are the other children). */
function stepLabel(page: Page, label: string): Locator {
  return checklistStep(page, label).locator('a span');
}

async function expectStepDone(page: Page, label: string, done: boolean): Promise<void> {
  const row = checklistStep(page, label);
  await expect(row, `„${label}” is rendered`).toHaveCount(1);
  await expect(
    stepLabel(page, label),
    `„${label}” ${done ? 'is crossed out' : 'is not crossed out yet'}`,
  ).toHaveCSS('text-decoration-line', done ? 'line-through' : 'none');
  await expect(
    row.locator('svg.lucide-check'),
    `„${label}” ${done ? 'shows its check' : 'has no check yet'}`,
  ).toHaveCount(done ? 1 : 0);
}

/** Read the counters the checklist is derived from (its only data source). */
async function studentStats(page: Page): Promise<StudentStats> {
  const response = await page.request.get('/api/v1/stats/student');
  expect(
    response.status(),
    `GET /api/v1/stats/student → ${response.status()} ${await response.text()}`,
  ).toBe(200);
  const body = (await response.json()) as Envelope<StudentStats>;
  expect(body.success, 'stats success flag').toBe(true);
  return body.data as StudentStats;
}

/** `POST` and require the created (201) envelope, returning its `data`. */
async function postData<T>(page: Page, url: string, data: unknown): Promise<T> {
  const response = await page.request.post(url, { data });
  const body = (await response.json()) as Envelope<T>;
  expect(response.status(), `POST ${url} → ${response.status()} ${JSON.stringify(body)}`).toBe(201);
  expect(body.data, `POST ${url} payload`).toBeTruthy();
  return body.data as T;
}

/** The visible instance of a control that `DeckCard` renders once per breakpoint. */
function visible(locator: Locator): Locator {
  return locator.filter({ visible: true });
}

/** The deck created above, as the product API lists it for this student. */
async function findDeck(page: Page, name: string): Promise<DeckItem> {
  const response = await page.request.get('/api/v1/flashcards/decks?limit=200');
  expect(response.status(), 'GET /api/v1/flashcards/decks').toBe(200);
  const body = (await response.json()) as Envelope<{ items: DeckItem[] }>;
  const deck = body.data?.items.find((item) => item.name === name);
  expect(deck, `the created deck „${name}” is listed`).toBeTruthy();
  return deck as DeckItem;
}

test.describe('@case:STU-02 @area:STU @prio:P2 student first-steps checklist', () => {
  test('marks each real step, then the all-done card can be hidden for good', async ({ page }) => {
    test.setTimeout(180_000);

    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    const suffix = tenant.runSuffix ?? tenant.key.slice(-6);
    const deckName = `STU-02 talia ${suffix}`;

    const pageErrors: string[] = [];
    const failedStats: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('response', (response) => {
      if (
        new URL(response.url()).pathname === '/api/v1/stats/student' &&
        response.status() >= 400
      ) {
        failedStats.push(`${response.status()} ${new URL(response.url()).pathname}`);
      }
    });

    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
    expect(new URL(page.url()).pathname, 'the student lands on /app').toBe('/app');
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

    // --- Step 1: the empty checklist -------------------------------------
    await expect(checklist(page)).toBeVisible();
    await expect(checklist(page).locator('[data-slot="card-title"]')).toHaveText(
      CHECKLIST_COPY.title,
    );
    await expect(checklist(page).locator('[data-slot="card-description"]')).toHaveText(
      CHECKLIST_COPY.description,
    );
    await expect
      .poll(() => checklist(page).locator('li a span').allTextContents(), {
        message: 'checklist labels in the case order',
      })
      .toEqual([...STEPS]);

    for (const step of STEPS) await expectStepDone(page, step, false);

    const emptyStats = await studentStats(page);
    expect(emptyStats, 'the fresh tenant has no deck, card or quiz').toMatchObject({
      totalDecks: 0,
      totalFlashcards: 0,
      totalQuizzes: 0,
      flashcardsPracticed: 0,
    });

    // --- Step 2: create the first deck, back to /app ----------------------
    await checklistStep(page, STEPS[0]).locator('a').click();
    await page.waitForURL((url) => url.pathname === '/app/flashcards', { timeout: 15_000 });

    await visible(page.getByRole('button', { name: 'Nowa talia' })).click();
    const deckDialog = page.getByRole('dialog');
    await expect(deckDialog).toBeVisible();
    await deckDialog.locator('input').first().fill(deckName);
    await deckDialog.locator('textarea').fill(DECK_DESCRIPTION);
    await deckDialog.getByRole('button', { name: 'Utwórz', exact: true }).click();
    await expect(page.getByText('Talia utworzona')).toBeVisible();

    const deck = await findDeck(page, deckName);
    expect(deck.description, 'the deck keeps the description from the dialog').toBe(
      DECK_DESCRIPTION,
    );

    await page.goto('/app');
    await expect(page).toHaveURL(/\/app$/);
    await expectStepDone(page, STEPS[0], true);
    await expectStepDone(page, STEPS[1], false);
    await expectStepDone(page, STEPS[2], false);
    await expectStepDone(page, STEPS[3], false);
    expect(await studentStats(page), 'only the deck counter moved').toMatchObject({
      totalDecks: 1,
      totalFlashcards: 0,
      totalQuizzes: 0,
      flashcardsPracticed: 0,
    });

    // --- Step 3: add a flashcard, back to /app ---------------------------
    await checklistStep(page, STEPS[1]).locator('a').click();
    await page.waitForURL((url) => url.pathname === '/app/flashcards', { timeout: 15_000 });

    await page.goto(`/app/flashcards/${deck.id}`);
    await expect(page).toHaveURL(new RegExp(`/app/flashcards/${deck.id}$`));
    await visible(page.getByRole('button', { name: 'Nowa Fiszka' })).click();
    const cardDialog = page.getByRole('dialog');
    await expect(cardDialog).toBeVisible();
    await cardDialog.locator('textarea').nth(0).fill(CARD_FRONT);
    await cardDialog.locator('textarea').nth(1).fill(CARD_BACK);
    await cardDialog.getByRole('button', { name: 'Utwórz', exact: true }).click();
    await expect(page.getByText('Fiszka utworzona pomyślnie')).toBeVisible();
    // Wait for the create dialog to finish closing: while it animates out the
    // same front text is still rendered inside it, and the list already has it.
    await expect(cardDialog).toBeHidden();
    await expect(
      page.getByText(CARD_FRONT, { exact: true }).filter({ visible: true }),
      'the new flashcard is listed in the deck',
    ).toHaveCount(1);

    await page.goto('/app');
    await expect(page).toHaveURL(/\/app$/);
    await expectStepDone(page, STEPS[0], true);
    await expectStepDone(page, STEPS[1], true);
    await expectStepDone(page, STEPS[2], false);
    await expectStepDone(page, STEPS[3], false);
    expect(await studentStats(page), 'the flashcard counter moved with the deck').toMatchObject({
      totalDecks: 1,
      totalFlashcards: 1,
      totalQuizzes: 0,
      flashcardsPracticed: 0,
    });

    // --- Step 4: take the first quiz, back to /app -----------------------
    // The quiz generator draws from the student's own question bank, so this run
    // creates exactly one MCQ through the product API first. That is fixture
    // setup, not the surface under test.
    const bank = await postData<{ id: string }>(page, '/api/v1/questions/banks', {
      name: `STU-02 bank ${suffix}`,
    });
    await postData<{ id: string }>(page, '/api/v1/questions', {
      bankId: bank.id,
      type: 'mcq',
      content: QUIZ_CONTENT,
      answers: [
        { content: QUIZ_CORRECT, isCorrect: true, orderIndex: 0 },
        { content: QUIZ_WRONG, isCorrect: false, orderIndex: 1 },
      ],
    });

    await checklistStep(page, STEPS[2]).locator('a').click();
    await expect(page).toHaveURL(/\/app\/study(\/|$)/, { timeout: 15_000 });

    await page.goto('/app/study/quiz');
    await expect(page).toHaveURL(/\/app\/study\/quiz$/);
    const mcqToggle = page.locator('#quiz-type-mcq');
    await expect(mcqToggle).toBeVisible();
    await expect(async () => {
      await mcqToggle.click();
      await expect(mcqToggle).toHaveAttribute('aria-checked', 'true', { timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
    await page.locator('input[type="number"]').fill('1');

    const generate = page.getByRole('button', { name: 'Generuj quiz' });
    await expect(generate).toBeEnabled({ timeout: 30_000 });
    await generate.click();
    await page.waitForURL(
      /\/app\/study\/session\/quiz\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      { timeout: 60_000 },
    );

    const quizQuestion = page.getByText(QUIZ_CONTENT, { exact: true }).filter({ visible: true });
    await expect(quizQuestion, 'the generated quiz contains only this run’s question').toHaveCount(
      1,
    );
    const correctAnswer = page.getByText(QUIZ_CORRECT, { exact: true }).filter({ visible: true });
    await expect(correctAnswer).toHaveCount(1);
    await correctAnswer.click();
    await page.getByRole('button', { name: 'Zakończ test' }).click();
    await page.waitForURL(/\/app\/study\/session\/quiz\/[0-9a-f-]{36}\/review$/, {
      timeout: 30_000,
    });
    await expect(page.getByText('Wynik: 100%')).toBeVisible();
    await expect(page.getByText('1 z 1 poprawnych')).toBeVisible();

    await page.goto('/app');
    await expect(page).toHaveURL(/\/app$/);
    await expectStepDone(page, STEPS[0], true);
    await expectStepDone(page, STEPS[1], true);
    await expectStepDone(page, STEPS[2], true);
    await expectStepDone(page, STEPS[3], false);
    expect(await studentStats(page), 'the completed attempt is counted').toMatchObject({
      totalDecks: 1,
      totalFlashcards: 1,
      totalQuizzes: 1,
      flashcardsPracticed: 0,
    });

    // --- Step 5: review the card, back to /app ---------------------------
    await checklistStep(page, STEPS[3]).locator('a').click();
    await expect(page).toHaveURL(/\/app\/study(\/|$)/, { timeout: 15_000 });

    await page.goto('/app/study/learn');
    await expect(page).toHaveURL(/\/app\/study\/learn$/);
    await page.getByRole('button', { name: 'Rozpocznij naukę' }).click();
    await page.waitForURL(/\/app\/study\/session\/[a-z]+/, { timeout: 30_000 });

    const sessionFront = page.getByText(CARD_FRONT, { exact: true }).filter({ visible: true });
    await expect(sessionFront, 'the session shows this run’s card').toHaveCount(1);
    await sessionFront.click();
    await expect(
      page.getByText('Kliknij, aby odkryć odpowiedź'),
      'the card is revealed after the click',
    ).toHaveCount(0);
    await expect(
      page.getByText(CARD_BACK, { exact: true }).filter({ visible: true }),
      'the revealed card shows its answer',
    ).toHaveCount(1);
    await page.getByRole('button', { name: 'Dobrze (dalej)' }).click();
    await expect(page.getByText('Sesja zakończona!')).toBeVisible({ timeout: 30_000 });

    await page.goto('/app');
    await expect(page).toHaveURL(/\/app$/);
    for (const step of STEPS) await expectStepDone(page, step, true);
    expect(await studentStats(page), 'the review closed the last gap').toMatchObject({
      totalDecks: 1,
      totalFlashcards: 1,
      totalQuizzes: 1,
      flashcardsPracticed: 1,
    });

    // --- All done: the card says so and can be hidden for good -----------
    await expect(checklist(page).locator('[data-slot="card-title"]')).toHaveText(
      CHECKLIST_COPY.allDoneTitle,
    );
    await expect(checklist(page).locator('[data-slot="card-description"]')).toHaveText(
      CHECKLIST_COPY.allDoneDescription,
    );

    const dismiss = checklist(page).getByRole('button', { name: CHECKLIST_COPY.dismissLabel });
    await expect(dismiss).toBeVisible();
    await dismiss.click();
    await expect(checklist(page)).toHaveCount(0);
    expect(
      await page.evaluate(() => localStorage.getItem('app_onboarding_dismissed')),
      'dismissal is remembered',
    ).toBe('true');

    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(checklist(page), 'the hidden card stays hidden after reload').toHaveCount(0);
    expect(await studentStats(page), 'hiding the card does not change the data').toMatchObject({
      totalDecks: 1,
      totalFlashcards: 1,
      totalQuizzes: 1,
      flashcardsPracticed: 1,
    });

    expect(failedStats, 'the checklist data source never failed').toEqual([]);
    expect(pageErrors, 'no uncaught page errors while completing the checklist').toEqual([]);
  });
});
