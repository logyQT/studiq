import { expect, type Page, test } from '@playwright/test';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

/**
 * LIM-02 — the plan limits are enforced at the plan's real cap.
 *
 * The case was written for the legacy manual seed (`test-student@dev.local`,
 * password `pass`) and starts with a **global** `update plan_limits ... where
 * plan_key = 'base'` that lowers the Base limits to 2 so the whole check fits
 * two records. A QA-suite spec must not mutate the shared plan catalogue: every
 * tenant on the shared database reads `plan_limits`, so lowering Base would
 * change LIM-03 (buy Spark after the lowered Base) and every other case, and it
 * only "works" until someone resets the DB.
 *
 * The tenant therefore reproduces the same starting point at the real Base cap
 * that LIM-01 documents and `/app/billing` shows:
 *
 *   bun scripts/qa-tenant.ts LIM-02 --fresh   # profile: __tests__/qa/profiles/LIM-02.json
 *
 * `bare`/`student` is the case's TS account: one student, no organization, no
 * group and the free `base` personal plan from `handle_new_user`. Outside an org
 * the personal plan governs the counters (#233), so the spec fills only this
 * student's own decks/cards/banks/questions up to the Base caps (10 / 100 / 5 /
 * 50) and asserts that the next one is refused — the same enforcement path the
 * manual case exercises with the artificial "2".
 *
 * Walked on the shared app (pl) before writing this test:
 * - deck 11: `POST /api/v1/flashcards/decks` → 429 `USAGE_LIMIT_EXCEEDED`; the
 *   create dialog stays open and an error toast appears ("Nie udało się zapisać
 *   talii"), never a blank screen;
 * - card 101: `POST /api/v1/flashcards` → 429; toast "Nie udało się zapisać";
 * - bank 6: `POST /api/v1/questions/banks` → 429 (the case's "not enforced"
 *   observation is obsolete — #183 fixed `max_question_banks`); toast "Coś poszło
 *   nie tak. Spróbuj ponownie.";
 * - question 51: `POST /api/v1/questions` → 429; toast "Nie udało się zapisać
 *   pytania".
 * Every refusal leaves the counter untouched.
 *
 * Re-runnability: CI retries against the same tenant, so the setup tops the
 * tenant up to the limit only for the elements it is missing and never tries to
 * create past it. Nothing global is written: the plan catalogue is read through
 * the public API, the payment/plan rows are untouched, and every row the spec
 * creates belongs to this tenant's student.
 */

const CASE = 'LIM-02';

const UI = {
  errorToast: '[data-sonner-toast][data-type="error"]',
  newDeck: 'Nowa talia',
  deckNamePlaceholder: 'np. Przygotowanie do egzaminu, Rozdział 1...',
  newCard: 'Nowa Fiszka',
  cardFrontPlaceholder: 'Wprowadź pytanie lub prompt...',
  cardBackPlaceholder: 'Wprowadź odpowiedź lub wyjaśnienie...',
  newBank: 'Nowy bank',
  bankNamePlaceholder: 'np. Biologia Egzamin',
  newQuestion: 'Utwórz pytanie',
  questionPlaceholder: 'Wpisz swoje pytanie...',
  answer1Placeholder: 'Odpowiedź 1',
  answer2Placeholder: 'Odpowiedź 2',
  addAnswer: 'Dodaj odpowiedź',
  create: 'Utwórz',
} as const;

/** The Base caps from LIM-01, as `/api/v1/me/personal-plan` reports them. */
const LIMIT = { decks: 10, flashcards: 100, banks: 5, questions: 50 } as const;

/** Names of the deck/bank that hold the over-limit attempts. */
const CARD_DECK = 'QA LIM-02 flashcards';
const QUESTION_BANK = 'QA LIM-02 questions';

interface Envelope<T> {
  success: boolean;
  data: T;
  error?: string;
}

interface DeckItem {
  id: string;
  name: string;
}

interface DeckList {
  items: DeckItem[];
  total: number;
}

interface BankItem {
  id: string;
  name: string;
}

interface BankList {
  items: BankItem[];
  hasMore: boolean;
}

interface QuestionItem {
  id: string;
  content: string;
}

async function getJson<T>(page: Page, url: string): Promise<T> {
  const res = await page.request.get(url);
  const body = (await res.json()) as Envelope<T>;
  expect(res.status(), `GET ${url} → ${res.status()} ${JSON.stringify(body)}`).toBe(200);
  expect(body.success, `GET ${url}`).toBe(true);
  return body.data;
}

function listDecks(page: Page): Promise<DeckList> {
  return getJson<DeckList>(
    page,
    '/api/v1/flashcards/decks?owner=mine&sortBy=created_at&sortOrder=desc&limit=100',
  );
}

function deckDetail(page: Page, deckId: string): Promise<{ flashcard_count: number }> {
  return getJson(page, `/api/v1/flashcards/decks/${deckId}`);
}

function listBanks(page: Page): Promise<BankList> {
  return getJson<BankList>(
    page,
    '/api/v1/questions/banks?sortBy=created_at&sortOrder=desc&limit=100',
  );
}

function listQuestions(page: Page, bankId: string): Promise<QuestionItem[]> {
  return getJson<QuestionItem[]>(page, `/api/v1/questions?bankId=${bankId}`);
}

/** A create request that the plan limit has to refuse. */
async function expectRefused(
  page: Page,
  url: string,
  data: Record<string, unknown>,
  label: string,
): Promise<void> {
  const res = await page.request.post(url, { data });
  const body = (await res.json()) as Envelope<unknown>;
  expect(res.status(), `${label}: POST ${url} is refused`).toBe(429);
  expect(body.success, `${label}: POST ${url} is not a success`).toBe(false);
  expect(body.error, `${label}: the limit error code`).toMatch(/USAGE_LIMIT_EXCEEDED/);
}

/** Resolve the POST that a dialog submit fires, whatever the create route is. */
function waitForPost(page: Page, pathname: string) {
  return page.waitForResponse(
    (res) => res.request().method() === 'POST' && new URL(res.url()).pathname === pathname,
  );
}

/**
 * Fill this tenant up to the Base caps through the product API. Only the missing
 * elements are created, so a retry on the same tenant is a no-op.
 */
async function fillTenantToBaseCaps(page: Page): Promise<{ deckId: string; bankId: string }> {
  // The deck that will hold the 100 flashcards. Created first so it never
  // consumes a slot the deck-limit phase has already filled.
  let decks = await listDecks(page);
  let cardDeck = decks.items.find((deck) => deck.name === CARD_DECK);
  if (!cardDeck) {
    const created = await page.request.post('/api/v1/flashcards/decks', {
      data: { name: CARD_DECK },
    });
    expect(created.status(), `POST /api/v1/flashcards/decks (${CARD_DECK})`).toBe(201);
    cardDeck = (await created.json()).data as DeckItem;
  }

  // The bank that will hold the 50 questions, for the same reason.
  let banks = await listBanks(page);
  expect(banks.hasMore, 'five Base banks fit on one page').toBe(false);
  let questionBank = banks.items.find((bank) => bank.name === QUESTION_BANK);
  if (!questionBank) {
    const created = await page.request.post('/api/v1/questions/banks', {
      data: { name: QUESTION_BANK },
    });
    expect(created.status(), `POST /api/v1/questions/banks (${QUESTION_BANK})`).toBe(201);
    questionBank = (await created.json()).data as BankItem;
  }

  // Decks: one at a time, through the route the UI uses, so the last allowed
  // deck is created at the cap and the next one is the refusal.
  decks = await listDecks(page);
  expect(decks.total, 'the tenant never starts above the cap').toBeLessThanOrEqual(LIMIT.decks);
  for (let total = decks.total; total < LIMIT.decks; total++) {
    const res = await page.request.post('/api/v1/flashcards/decks', {
      data: { name: `QA LIM-02 deck ${total + 1}` },
    });
    expect(res.status(), `deck ${total + 1} of ${LIMIT.decks} is created`).toBe(201);
  }
  decks = await listDecks(page);
  expect(decks.total, 'the tenant owns exactly the Base deck quota').toBe(LIMIT.decks);

  // Flashcards: the bulk create the import flow uses.
  let cardCount = (await deckDetail(page, cardDeck.id)).flashcard_count;
  if (cardCount < LIMIT.flashcards) {
    const cards = Array.from({ length: LIMIT.flashcards - cardCount }, (_, index) => ({
      front: `QA LIM-02 front ${cardCount + index + 1}`,
      back: `QA LIM-02 back ${cardCount + index + 1}`,
    }));
    const res = await page.request.post('/api/v1/flashcards/batch/create', {
      data: { deckId: cardDeck.id, cards },
    });
    expect(res.status(), `fill the deck to ${LIMIT.flashcards} flashcards`).toBe(201);
    cardCount = (await deckDetail(page, cardDeck.id)).flashcard_count;
  }
  expect(cardCount, 'the tenant owns exactly the Base flashcard quota').toBe(LIMIT.flashcards);

  // Question banks: one at a time, like the UI.
  banks = await listBanks(page);
  expect(banks.items.length, 'the tenant never starts above the bank cap').toBeLessThanOrEqual(
    LIMIT.banks,
  );
  for (let total = banks.items.length; total < LIMIT.banks; total++) {
    const res = await page.request.post('/api/v1/questions/banks', {
      data: { name: `QA LIM-02 bank ${total + 1}` },
    });
    expect(res.status(), `bank ${total + 1} of ${LIMIT.banks} is created`).toBe(201);
  }
  banks = await listBanks(page);
  expect(banks.items.length, 'the tenant owns exactly the Base bank quota').toBe(LIMIT.banks);

  // Questions: one at a time, like the UI.
  let questions = await listQuestions(page, questionBank.id);
  for (let total = questions.length; total < LIMIT.questions; total++) {
    const res = await page.request.post('/api/v1/questions', {
      data: { bankId: questionBank.id, type: 'open', content: `QA LIM-02 question ${total + 1}` },
    });
    expect(res.status(), `question ${total + 1} of ${LIMIT.questions} is created`).toBe(201);
  }
  questions = await listQuestions(page, questionBank.id);
  expect(questions.length, 'the tenant owns exactly the Base question quota').toBe(LIMIT.questions);

  return { deckId: cardDeck.id, bankId: questionBank.id };
}

test.describe('@case:LIM-02 @area:LIM @prio:P1 plan limits at the Base cap', () => {
  test('the next deck, flashcard, bank and question are refused with a readable error', async ({
    page,
  }) => {
    test.setTimeout(240_000);

    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} runs on the bare tenant profile`).toBe('bare');
    expect(tenant.role, `${CASE} needs a bare student`).toBe('student');
    expect(tenant.org, 'the student under test belongs to no organization').toBeNull();
    expect(
      tenant.runSuffix,
      'seed with --fresh: every independent run owns a new, still-empty student',
    ).toBeTruthy();
    if (!tenant.users.student) {
      throw new Error(
        `LIM-02 fixture incomplete: run \`bun scripts/qa-tenant.ts ${CASE} --fresh\``,
      );
    }

    await loginAs(page, tenant, 'student', { locale: 'pl' });
    await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });

    // --- Precondition: the case's standalone TS student on Base ----------
    const plan = await getJson<{ key: string; limits: Record<string, number> }>(
      page,
      '/api/v1/me/personal-plan',
    );
    expect(plan.key, 'the tenant student is on the free Base plan').toBe('base');
    expect(plan.limits, 'the Base caps from LIM-01').toMatchObject({
      max_decks: LIMIT.decks,
      max_flashcards: LIMIT.flashcards,
      max_questions: LIMIT.questions,
      max_question_banks: LIMIT.banks,
    });

    const { deckId, bankId } = await fillTenantToBaseCaps(page);
    const errorToast = page.locator(UI.errorToast);

    // --- The API refuses the (limit + 1)-th element of every kind --------
    await expectRefused(
      page,
      '/api/v1/flashcards/decks',
      { name: 'QA LIM-02 over-limit deck' },
      'deck',
    );
    await expectRefused(
      page,
      '/api/v1/flashcards',
      { deckId, front: 'QA LIM-02 over-limit front', back: 'QA LIM-02 over-limit back' },
      'flashcard',
    );
    await expectRefused(
      page,
      '/api/v1/questions/banks',
      { name: 'QA LIM-02 over-limit bank' },
      'question bank',
    );
    await expectRefused(
      page,
      '/api/v1/questions',
      { bankId, type: 'open', content: 'QA LIM-02 over-limit question' },
      'question',
    );

    // No refusal may have written anything.
    expect((await listDecks(page)).total, 'no deck over the cap').toBe(LIMIT.decks);
    expect((await deckDetail(page, deckId)).flashcard_count, 'no flashcard over the cap').toBe(
      LIMIT.flashcards,
    );
    expect((await listBanks(page)).items.length, 'no bank over the cap').toBe(LIMIT.banks);
    expect((await listQuestions(page, bankId)).length, 'no question over the cap').toBe(
      LIMIT.questions,
    );

    // --- Step 2: a third… here the 11th deck through the UI --------------
    // Each surface is exercised through its own dialog so the expected result
    // ("readable message, not a blank screen") is checked where the user sees it.
    await page.goto('/app/flashcards');
    await expect(page.getByRole('button', { name: UI.newDeck, exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: UI.newDeck, exact: true }).first().click();
    let dialog = page.getByRole('dialog');
    await expect(dialog, 'the create-deck dialog opens').toBeVisible();
    await dialog.getByPlaceholder(UI.deckNamePlaceholder).fill('QA LIM-02 over-limit deck');
    let refused = waitForPost(page, '/api/v1/flashcards/decks');
    await dialog.getByRole('button', { name: UI.create, exact: true }).click();
    expect((await refused).status(), 'the UI deck create is refused with 429').toBe(429);
    await expect(errorToast, 'the over-limit deck shows a readable error toast').toBeVisible();
    await expect(errorToast, 'the toast carries a message, not an empty box').toHaveText(/\S+/);
    await expect(dialog, 'the deck dialog stays open — no blank screen').toBeVisible();
    expect((await listDecks(page)).total, 'the UI deck attempt created nothing').toBe(LIMIT.decks);

    // --- Step 3: the 101st flashcard (manually) --------------------------
    await page.goto(`/app/flashcards/${deckId}`);
    await expect(page.getByRole('button', { name: UI.newCard, exact: true })).toBeVisible();
    await page.getByRole('button', { name: UI.newCard, exact: true }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog, 'the create-card dialog opens').toBeVisible();
    await dialog.getByPlaceholder(UI.cardFrontPlaceholder).fill('QA LIM-02 over-limit card');
    await dialog.getByPlaceholder(UI.cardBackPlaceholder).fill('QA LIM-02 over-limit answer');
    refused = waitForPost(page, '/api/v1/flashcards');
    await dialog.getByRole('button', { name: UI.create, exact: true }).click();
    expect((await refused).status(), 'the UI flashcard create is refused with 429').toBe(429);
    await expect(errorToast, 'the over-limit card shows a readable error toast').toBeVisible();
    await expect(errorToast, 'the toast carries a message, not an empty box').toHaveText(/\S+/);
    await expect(dialog, 'the card dialog stays open — no blank screen').toBeVisible();
    expect(
      (await deckDetail(page, deckId)).flashcard_count,
      'the UI card attempt created nothing',
    ).toBe(LIMIT.flashcards);

    // --- Step 4: the 6th question bank ----------------------------------
    await page.goto('/app/questions');
    await expect(page.getByRole('button', { name: UI.newBank, exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: UI.newBank, exact: true }).first().click();
    dialog = page.getByRole('dialog');
    await expect(dialog, 'the create-bank dialog opens').toBeVisible();
    await dialog.getByPlaceholder(UI.bankNamePlaceholder).fill('QA LIM-02 over-limit bank');
    refused = waitForPost(page, '/api/v1/questions/banks');
    await dialog.getByRole('button', { name: UI.create, exact: true }).click();
    expect((await refused).status(), 'the UI bank create is refused with 429').toBe(429);
    await expect(errorToast, 'the over-limit bank shows a readable error toast').toBeVisible();
    await expect(errorToast, 'the toast carries a message, not an empty box').toHaveText(/\S+/);
    await expect(dialog, 'the bank dialog stays open — no blank screen').toBeVisible();
    expect((await listBanks(page)).items.length, 'the UI bank attempt created nothing').toBe(
      LIMIT.banks,
    );

    // --- Step 5: the 51st question --------------------------------------
    await page.goto(`/app/questions/${bankId}`);
    await expect(page.getByRole('button', { name: UI.newQuestion, exact: true })).toBeVisible();
    await page.getByRole('button', { name: UI.newQuestion, exact: true }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog, 'the create-question dialog opens').toBeVisible();
    await dialog.getByPlaceholder(UI.questionPlaceholder).fill('QA LIM-02 over-limit question');
    await dialog.getByPlaceholder(UI.answer1Placeholder).fill('QA LIM-02 answer A');
    await dialog.getByRole('button', { name: UI.addAnswer, exact: true }).click();
    await dialog.getByPlaceholder(UI.answer2Placeholder).fill('QA LIM-02 answer B');
    await dialog.locator('input[name="correctAnswer"]').first().check();
    refused = waitForPost(page, '/api/v1/questions');
    await dialog.getByRole('button', { name: UI.create, exact: true }).click();
    expect((await refused).status(), 'the UI question create is refused with 429').toBe(429);
    await expect(errorToast, 'the over-limit question shows a readable error toast').toBeVisible();
    await expect(errorToast, 'the toast carries a message, not an empty box').toHaveText(/\S+/);
    await expect(dialog, 'the question dialog stays open — no blank screen').toBeVisible();
    expect(
      (await listQuestions(page, bankId)).length,
      'the UI question attempt created nothing',
    ).toBe(LIMIT.questions);
  });
});
