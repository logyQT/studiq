import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * STU-08 — Wkuwanie wybranej talii (`/app/study/cram`).
 *
 * Case steps: open the cram picker from the student menu, pick a deck and start
 * „Wkuwaj”, then rate a few cards and end the session.
 *
 * Tenant (deterministic, `content` profile, a fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts STU-08 --fresh
 *
 * gives the org `qa-stu-08-<suffix>` with a manager, an educator and the student
 * under test, plus the default group `G1` — all ids derived from
 * `tenantKey('qa/cases/STU-08.md', 'STU-08#<suffix>', 'qa-shared')` +
 * `tenantId(key, entity)`. The legacy seed (`student1@dev.local`, decks `O1G1T1` /
 * `O1S1`) maps onto this student, who owns the two personal decks the spec creates
 * through the product API. Nothing global is read or written: no admin setting,
 * feature flag, plan, platform stat or singleton row, and no other tenant.
 *
 * Acceptance points (confirmed in the walk on the shared app, Polish UI):
 * 1. The picker shows the „Wybierz talię i wkuwaj karty we własnym tempie”
 *    description and every deck with its flashcard counter („3 fiszki”,
 *    „1 fiszka”) and a „Wkuwaj” action.
 * 2. „Wkuwaj” opens `/app/study/session/cram?deckId=…` and walks **all** cards of
 *    the deck even though none of them is due: `practice/due/count` is 0 while
 *    `practice/prepare` returns the full deck. The session writes no SM-2 state
 *    (`practice/states.practicedCards` stays 0 and every `reviewState` stays null).
 * 3. Finishing the queue opens the summary with „Sesja zakończona!”, the score,
 *    the „Wkuwanie” badge and the buttons „Wkuj ponownie” and „Powrót do
 *    wkuwania”. „Wkuj ponownie” restarts the same deck in place (score reset, all
 *    cards again); „Powrót do wkuwania” returns to the picker.
 */

const CASE = 'STU-08';

const COPY = {
  description: 'Wybierz talię i wkuwaj karty we własnym tempie',
  start: 'Wkuwaj',
  revealHint: 'Kliknij, aby odkryć odpowiedź',
  exit: 'Zakończ sesję',
  good: 'Dobrze (dalej)',
  summaryTitle: 'Sesja zakończona!',
  modeCram: 'Wkuwanie',
  playAgain: 'Wkuj ponownie',
  back: 'Powrót do wkuwania',
  loginTitle: 'Witaj ponownie',
} as const;

/** Decks the spec creates in its own tenant; names are case-scoped. */
const DECKS = {
  main: 'STU-08 wkuwanie',
  other: 'STU-08 druga',
} as const;

const MAIN_FRONTS = ['STU-08 pytanie A', 'STU-08 pytanie B', 'STU-08 pytanie C'] as const;
const OTHER_FRONTS = ['STU-08 pytanie D'] as const;

const DECKS_URL = '/api/v1/flashcards/decks';
const CARDS_URL = '/api/v1/flashcards';

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface DeckListItem {
  id: string;
  name: string;
  created_by: string;
  flashcard_count: number;
}

interface DeckListResult {
  items: DeckListItem[];
  total: number;
}

interface FlashcardRow {
  id: string;
  front: string;
  back: string;
  deck_id: string;
}

interface FlashcardListResult {
  items: FlashcardRow[];
}

interface PracticeCard {
  id: string;
  front: string;
  reviewState: unknown | null;
}

interface StateBreakdown {
  totalCards: number;
  neverPracticed: number;
  practicedCards: number;
  learning: number;
  review: number;
  relearning: number;
  leeched: number;
}

/** `GET` an endpoint as the signed-in student and unwrap the response envelope. */
async function getData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.ok(), `GET ${url} → ${response.status()} ${await response.text()}`).toBe(true);
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data;
}

/** `GET /api/v1/flashcards/decks` — the same list the picker renders. */
async function listDecks(page: Page): Promise<DeckListResult> {
  return getData<DeckListResult>(page, `${DECKS_URL}?limit=200`);
}

/** The deck's cards, read through the same list endpoint the deck view uses. */
async function listCards(page: Page, deckId: string): Promise<FlashcardRow[]> {
  const result = await getData<FlashcardListResult>(
    page,
    `${CARDS_URL}?deckIds=${deckId}&limit=100`,
  );
  return result.items;
}

/**
 * Create one of the case's decks if the tenant does not have it yet. Idempotent so
 * a re-run on an already-seeded tenant neither fails on duplicates nor depends on
 * another run's leftovers.
 */
async function ensureDeck(page: Page, name: string): Promise<DeckListItem> {
  const existing = (await listDecks(page)).items.find((deck) => deck.name === name);
  if (existing) return existing;

  const response = await page.request.post(DECKS_URL, {
    data: { name, visibility: 'personal' },
  });
  expect(
    response.status(),
    `POST ${DECKS_URL} (${name}) → ${response.status()} ${await response.text()}`,
  ).toBe(201);
  const body = (await response.json()) as ApiEnvelope<DeckListItem>;
  expect(body.success, `POST ${DECKS_URL} (${name}) success flag`).toBe(true);
  return body.data;
}

/** Add a card to the deck unless its front already exists (idempotent re-run). */
async function ensureCard(
  page: Page,
  deck: DeckListItem,
  front: string,
  back: string,
): Promise<void> {
  const existing = (await listCards(page, deck.id)).find((card) => card.front === front);
  if (existing) return;

  const response = await page.request.post(CARDS_URL, {
    data: { deckId: deck.id, front, back },
  });
  expect(
    response.status(),
    `POST ${CARDS_URL} (${front}) → ${response.status()} ${await response.text()}`,
  ).toBe(201);
  const body = (await response.json()) as ApiEnvelope<FlashcardRow>;
  expect(body.success, `POST ${CARDS_URL} (${front}) success flag`).toBe(true);
}

/**
 * Prepare the student's own content: two personal decks, one with three cards and
 * one with a single card, so the picker's per-deck counter and the deck choice are
 * both observable. Created through the product API so RBAC and the deck/card
 * models decide what is allowed.
 */
async function prepareTenant(
  page: Page,
  tenant: QaTenant,
): Promise<{
  main: DeckListItem;
  other: DeckListItem;
}> {
  if (!tenant.org || !tenant.users.student) {
    throw new Error(`${CASE} needs the content tenant profile (org + student)`);
  }

  const main = await ensureDeck(page, DECKS.main);
  const other = await ensureDeck(page, DECKS.other);

  for (const front of MAIN_FRONTS) {
    await ensureCard(page, main, front, `STU-08 odpowiedź ${front.slice(-1)}`);
  }
  for (const front of OTHER_FRONTS) {
    await ensureCard(page, other, front, `STU-08 odpowiedź ${front.slice(-1)}`);
  }

  return { main, other };
}

/** The picker card whose title is this deck name. */
function deckCard(page: Page, name: string): Locator {
  return page.locator('[data-slot="card"]').filter({
    has: page.getByRole('heading', { name, exact: true }),
  });
}

/** The visible flashcard counter badge on a picker card. */
function countBadge(card: Locator, label: string): Locator {
  return card.locator('[data-slot="badge"]:visible').filter({ hasText: label });
}

/**
 * The card the cram session currently shows. `FlashcardFlip` is the only element
 * with an inline `perspective`; it stays mounted for the whole session.
 */
function sessionCard(page: Page): Locator {
  return page.locator('div[style*="perspective"]');
}

/** The front shown by the current session card, or `null` mid-transition. */
async function readQuestion(card: Locator): Promise<string | null> {
  try {
    const lines = (await card.innerText())
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^STU-08 pytanie [A-D]$/.test(line));
    return lines.length === 1 ? lines[0] : null;
  } catch {
    // The card can be detached for a frame between the exit and entry of the
    // animated card; the poll retries until the next card settles.
    return null;
  }
}

async function currentQuestion(card: Locator): Promise<string> {
  const question = await readQuestion(card);
  expect(question, 'exactly one cram card is on screen').not.toBeNull();
  return question as string;
}

/**
 * Rate the deck's cards with „Dobrze (dalej)”, revealing each answer first as a
 * tester would. Returns the fronts in the order the session presented them.
 */
async function rateWholeDeck(page: Page, card: Locator, expectedCards: number): Promise<string[]> {
  const seen: string[] = [];

  for (let index = 0; index < expectedCards; index += 1) {
    const front = await currentQuestion(card);
    seen.push(front);

    await expect(
      page.getByText(COPY.revealHint, { exact: true }),
      'the answer is hidden before the flip',
    ).toBeVisible();
    await card.click();
    await expect(
      page.getByText(COPY.revealHint, { exact: true }),
      'the flip reveals the answer',
    ).toHaveCount(0);

    await page.getByRole('button', { name: COPY.good, exact: true }).click();

    if (index < expectedCards - 1) {
      // Wait for the next card to enter before reading it; the queued card never
      // repeats, so a changed front proves the queue advanced.
      await expect.poll(() => readQuestion(card), { timeout: 30_000 }).not.toBe(front);
    }
  }

  return seen;
}

/** The completion summary, shared by the replay and back assertions. */
function summary(page: Page): Locator {
  return page.getByRole('dialog');
}

test.describe('@case:STU-08 @area:STU @prio:P2 cram study mode', () => {
  test('lists decks with card counts, crams every card and offers replay/back', async ({
    page,
  }) => {
    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} runs on the content tenant profile`).toBe('content');
    expect(tenant.org, `${CASE} needs an organization`).not.toBeNull();
    const student = tenant.users.student;
    expect(student, `${CASE} seeds the student under test`).toBeTruthy();

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
    await expect(page).toHaveURL(/\/app$/);

    const { main, other } = await prepareTenant(page, tenant);

    // The tenant holds exactly the two decks this case creates, each with its
    // own card count — no shared or foreign content leaks into the picker.
    const deckList = await listDecks(page);
    expect(deckList.total, 'decks visible to the student').toBe(2);
    expect(
      deckList.items.find((deck) => deck.id === main.id)?.flashcard_count,
      'the main deck has three cards',
    ).toBe(MAIN_FRONTS.length);
    expect(
      deckList.items.find((deck) => deck.id === other.id)?.flashcard_count,
      'the second deck has one card',
    ).toBe(OTHER_FRONTS.length);

    // SM-2 precondition: none of these cards is due, because none was studied.
    const due = await getData<{ count: number }>(
      page,
      `/api/v1/flashcards/practice/due/count?deckIds=${main.id}`,
    );
    expect(due.count, 'no card of the main deck is due for review').toBe(0);

    const preparedBefore = await getData<PracticeCard[]>(
      page,
      `/api/v1/flashcards/practice/prepare?deckIds=${main.id}`,
    );
    expect(
      preparedBefore.map((card) => card.front).sort(),
      'cram prepares the whole deck, due or not',
    ).toEqual([...MAIN_FRONTS].sort());
    expect(
      preparedBefore.every((card) => card.reviewState === null),
      'the cards have no SM-2 state yet',
    ).toBe(true);

    // --- Step 1: the cram picker ------------------------------------------
    await page.goto('/app/study/cram');
    await expect(page).toHaveURL(/\/app\/study\/cram$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
    await expect(
      page.getByText(COPY.description, { exact: true }),
      'the picker explains the cram mode',
    ).toBeVisible();

    for (const [deck, countLabel] of [
      [main, '3 fiszki'],
      [other, '1 fiszka'],
    ] as const) {
      const card = deckCard(page, deck.name);
      await expect(card, `picker card "${deck.name}"`).toBeVisible();
      await expect(countBadge(card, countLabel), `"${deck.name}" counter`).toHaveCount(1);
      await expect(
        card.getByRole('button', { name: COPY.start, exact: true }),
        `"${deck.name}" starts cram`,
      ).toBeVisible();
    }

    // --- Step 2: start the chosen deck ------------------------------------
    const startRequest = page.waitForRequest((request) =>
      request.url().includes(`/api/v1/flashcards/practice/prepare?deckIds=${main.id}`),
    );
    await deckCard(page, main.name).getByRole('button', { name: COPY.start, exact: true }).click();
    await startRequest;
    await expect(page).toHaveURL(new RegExp(`/app/study/session/cram\\?deckId=${main.id}$`));

    const card = sessionCard(page);
    await expect(card, 'the first cram card is on screen').toBeVisible();
    await expect(
      page.getByRole('button', { name: COPY.exit, exact: true }),
      'the session can be left early',
    ).toBeVisible();
    await expect(page.getByText('0/0 poprawnych', { exact: true })).toBeVisible();

    // --- Step 3: rate every card and end the session ----------------------
    const firstRound = await rateWholeDeck(page, card, MAIN_FRONTS.length);
    expect(
      [...firstRound].sort(),
      'the session showed every card of the deck, in any order',
    ).toEqual([...MAIN_FRONTS].sort());

    const dialog = summary(page);
    await expect(dialog, 'the completion summary opens').toBeVisible();
    await expect(
      dialog.getByText(COPY.summaryTitle, { exact: true }),
      'the summary title',
    ).toBeVisible();
    await expect(
      dialog.getByText(`${MAIN_FRONTS.length} z ${MAIN_FRONTS.length} poprawnych`, {
        exact: true,
      }),
      'the cram score',
    ).toBeVisible();
    await expect(
      dialog.getByText(COPY.modeCram, { exact: true }),
      'the summary names the cram mode',
    ).toBeVisible();

    const playAgain = dialog.getByRole('button', { name: COPY.playAgain, exact: true });
    const backToCram = dialog.getByRole('button', { name: COPY.back, exact: true });
    await expect(playAgain, '„Wkuj ponownie” is offered').toBeVisible();
    await expect(playAgain, '„Wkuj ponownie” is usable').toBeEnabled();
    await expect(backToCram, '„Powrót do wkuwania” is offered').toBeVisible();
    await expect(backToCram, '„Powrót do wkuwania” is usable').toBeEnabled();

    // „Wkuj ponownie” restarts the same deck in place: no summary, zeroed score.
    await playAgain.click();
    await expect(dialog, 'replay closes the summary').toBeHidden();
    await expect(
      page.getByText('0/0 poprawnych', { exact: true }),
      'replay resets the score',
    ).toBeVisible();
    await expect(card, 'replay shows a card again').toBeVisible();

    const secondRound = await rateWholeDeck(page, card, MAIN_FRONTS.length);
    expect([...secondRound].sort(), 'replay crams the same whole deck again').toEqual(
      [...MAIN_FRONTS].sort(),
    );

    await expect(dialog, 'the replay run ends with the summary').toBeVisible();
    await dialog.getByRole('button', { name: COPY.back, exact: true }).click();

    // --- Expected result: back on the picker -------------------------------
    await expect(page).toHaveURL(/\/app\/study\/cram$/);
    await expect(page.getByText(COPY.description, { exact: true })).toBeVisible();
    await expect(deckCard(page, main.name)).toBeVisible();

    // Cram is side-effect-free: two full runs left the SM-2 schedule untouched.
    const preparedAfter = await getData<PracticeCard[]>(
      page,
      `/api/v1/flashcards/practice/prepare?deckIds=${main.id}`,
    );
    expect(
      preparedAfter.every((card) => card.reviewState === null),
      'cram writes no review state',
    ).toBe(true);
    const states = await getData<StateBreakdown>(page, '/api/v1/flashcards/practice/states');
    expect(states.totalCards, 'all tenant cards are still visible').toBe(
      MAIN_FRONTS.length + OTHER_FRONTS.length,
    );
    expect(states.practicedCards, 'cram did not count as SM-2 practice').toBe(0);
    expect(states.neverPracticed, 'every card is still unstudied').toBe(
      MAIN_FRONTS.length + OTHER_FRONTS.length,
    );
    expect(states.learning, 'nothing moved into learning').toBe(0);
    expect(states.review, 'nothing moved into review').toBe(0);
    expect(states.relearning, 'nothing moved into relearning').toBe(0);
    expect(states.leeched, 'nothing became a leech').toBe(0);

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });

  test('cram picker and session require a signed-in student', async ({ page }) => {
    // Adjacent regression for the same surface: cram renders student content and
    // must not be reachable anonymously, including a deep link with a deck id.
    const host = new URL(test.info().project.use.baseURL ?? 'http://localhost:3010').hostname;
    await page
      .context()
      .addCookies([{ name: 'NEXT_LOCALE', value: 'pl', domain: host, path: '/' }]);

    await page.goto('/app/study/cram');
    await expect(page, 'the picker redirects to login').toHaveURL(/\/login(\?|$)/);
    await expect(page.locator('[data-slot="card-title"]')).toHaveText(COPY.loginTitle);

    await page.goto('/app/study/session/cram?deckId=00000000-0000-5000-8000-000000000000');
    await expect(page, 'the session deep link redirects to login').toHaveURL(/\/login(\?|$)/);
    await expect(
      page.getByRole('button', { name: COPY.exit, exact: true }),
      'no cram session renders anonymously',
    ).toHaveCount(0);
  });
});
