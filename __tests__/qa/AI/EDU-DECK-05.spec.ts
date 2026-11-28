import { expect, type APIResponse, type Page, test } from '@playwright/test';
import { json } from '#test/helpers/json';
import { fakeLlm } from '#test/qa/AI/fake-llm';
import { loadTenant, loginAs } from '#test/qa/fixtures/tenant';

/**
 * EDU-DECK-05 — „Twórz z Agentem” in the educator's deck view.
 *
 * Case: in a deck, click „Twórz z Agentem”, generate flashcards and save them
 * into the deck. The chat must open with the deck as its target, and the save
 * must land in that deck — not in a new one. Without `ai.chat` the button is
 * hidden, or the route answers with the plan message.
 *
 * The model is the fake inference server (`bun run mock:llm`), fixture
 * `scripts/fake-llm/cases/EDU-DECK-05.deck-generate.json`: three cards, then
 * `finish`. It names the deck „Czasowniki nieregularne”, a name that must never
 * become a deck of its own while the chat has a target.
 *
 * Tenant: `content` on the `hub` organization plan with the teacher's personal
 * `plus` plan (`__tests__/qa/profiles/EDU-DECK-05.json`,
 * `personalPlan: "plus"`, `personalRole: "teacher"`), seeded through
 * `env:run`:
 *   `bun run env:run -- bun scripts/qa-tenant.ts EDU-DECK-05 --fresh`
 * The organization plan carries capacity only (#1493), so `ai.chat` reaches the
 * teacher through the personal layer. The manager holds no personal plan
 * (ADR-0007), so the same organization gives it no `ai.chat` — the unentitled
 * account, without a second tenant.
 *
 * Walk (2026-11-28, `test/qa-EDU-DECK-05` @ 896687d68, `env:ensure --profile qa`):
 * - The teacher's deck page renders „Twórz z Agentem” beside „Dodaj fiszkę”.
 *   It pushes `/edu/ai?deckId=<deckId>`, and the chat opens with the banner
 *   „Fiszki zapiszesz w talii <nazwa talii>” and a „Zapisz w nowej talii” escape.
 * - The generated block's button reads „Zapisz N fiszki do talii” (not „jako
 *   talię”), the save answers „Zapisano N fiszki do talii” and „Otwórz talię”,
 *   and the cards land in the opened deck; the API's deck list is unchanged.
 * - The case allows either outcome without AI. The product does both: the
 *   manager's deck page shows „Dodaj fiszkę” and no „Twórz z Agentem”, and a
 *   direct `/edu/ai?deckId=…` renders the locked card „Asystent Q nie jest
 *   dostępny w Twoim planie” with „Zobacz plany” instead of the composer. No
 *   model call is made before either refusal.
 * - „Dodaj fiszkę” is the control that makes the hidden button meaningful: it
 *   needs the same `deck.update` + `flashcard.create` pair the generator needs,
 *   so the manager's missing button can only come from the entitlement.
 *
 * Mutation (proves this spec can fail; each applied alone, rebuilt and reverted):
 * - `apps/web/src/components/ai/ai-chat-screen.tsx`, `deckTarget` forced to
 *   `null` — the deck context goes red: `expect(locator).toContainText(expected)
 *   failed / Locator: getByText('Fiszki zapiszesz w talii').locator('..') /
 *   Expected substring: "EDU-DECK-05 czasowniki" / Error: element(s) not found`.
 * - `apps/web/src/components/flashcards/shared/flashcard-toolbar.tsx`,
 *   `entitlement('ai.chat')` → `entitlement('flashcards')` — the hidden button
 *   goes red: `Error: no ai.chat, no generator / expect(locator).toHaveCount
 *   (expected) failed / Expected: 0 / Received: 1`.
 */

const CASE = 'EDU-DECK-05';

/** The deck the spec opens, named for the case. */
const DECK_NAME = 'EDU-DECK-05 czasowniki';

/** The deck name the fixture's model returns — a new deck would carry it. */
const MODEL_DECK_NAME = 'Czasowniki nieregularne';

const PROMPT = 'Dodaj 3 fiszki o czasowniku';

/** The fixture's three cards. */
const CARDS = [
  { front: 'Co to jest bezokolicznik?', back: 'Nieosobowa forma czasownika.' },
  { front: 'Jak odmienia się „iść” w 1. osobie?', back: 'Idę.' },
  { front: 'Co oznacza tryb rozkazujący?', back: 'Polecenie lub prośbę.' },
] as const;

interface Envelope<T> {
  success: boolean;
  data: T;
}

interface DeckRow {
  id: string;
  name: string;
}

interface CardRow {
  front: string;
  back: string;
  deck_id: string;
}

/** `GET`/`POST` an endpoint as the signed-in user and unwrap the envelope. */
async function data<T>(response: APIResponse, label: string): Promise<T> {
  expect(response.ok(), `${label} → ${response.status()} ${await response.text()}`).toBe(true);
  const body = await json<Envelope<T>>(response);
  expect(body.success, `${label} success flag`).toBe(true);
  return body.data;
}

/** Create the case's own deck through the product API. */
async function createDeck(page: Page, name: string): Promise<string> {
  const response = await page.request.post('/api/v1/flashcards/decks', {
    data: { name, visibility: 'personal' },
  });
  expect(response.status(), `POST /api/v1/flashcards/decks → ${await response.text()}`).toBe(201);
  const body = await json<Envelope<DeckRow>>(response);
  expect(body.success, 'POST /api/v1/flashcards/decks success flag').toBe(true);
  return body.data.id;
}

/** Every deck the signed-in account can read. */
async function deckList(page: Page): Promise<DeckRow[]> {
  const list = await data<{ items: DeckRow[] }>(
    await page.request.get('/api/v1/flashcards/decks?limit=100'),
    'GET /api/v1/flashcards/decks',
  );
  return list.items;
}

/** The cards stored in one deck, as the deck screen would read them. */
async function cardsOf(page: Page, deckId: string): Promise<CardRow[]> {
  const list = await data<{ items: CardRow[] }>(
    await page.request.get(`/api/v1/flashcards?deckIds=${deckId}&limit=100`),
    'GET /api/v1/flashcards',
  );
  return list.items;
}

test.describe('@case:EDU-DECK-05 @area:EDU @prio:P2 deck generator entry point', () => {
  test.beforeEach(async () => {
    await fakeLlm.reset();
  });

  test('opens the generator with the deck as target and saves the cards into that deck', async ({
    page,
  }) => {
    const tenant = loadTenant(CASE);
    await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu(\/|$)/ });
    const deckId = await createDeck(page, DECK_NAME);

    await page.goto(`/edu/flashcards/${deckId}`);
    const generate = page.getByRole('button', { name: 'Twórz z Agentem' });
    await expect(generate, 'the teacher with ai.chat sees the generator').toBeVisible();
    await generate.click();

    // The deck travels to the chat: it is the save target, not a new deck.
    await expect(page).toHaveURL(/\/edu\/ai\?deckId=/);
    expect(new URL(page.url()).searchParams.get('deckId'), 'deck context in the URL').toBe(deckId);
    await expect(page.getByText('Fiszki zapiszesz w talii').locator('..')).toContainText(DECK_NAME);

    await page.getByPlaceholder('Zapytaj Q').fill(PROMPT);
    await page.getByRole('button', { name: /^Wyślij/ }).click();
    await expect(page.getByText('Wygenerowano 3 fiszki')).toBeVisible();

    // „do talii”, not „jako talię”: the generated block already knows its deck.
    const save = page.getByRole('button', { name: 'Zapisz 3 fiszki do talii' });
    await expect(save).toBeVisible();
    const decksBefore = (await deckList(page)).map((deck) => deck.id).toSorted();
    await save.click();

    const openDeck = page.getByRole('link', { name: 'Otwórz talię' });
    await expect(openDeck.locator('..')).toContainText('Zapisano 3 fiszki do talii');
    await expect(openDeck).toHaveAttribute('href', `/edu/flashcards/${deckId}`);
    // A save into the current deck creates no deck — not even the model's name.
    const decksAfter = await deckList(page);
    expect(decksAfter.map((deck) => deck.id).toSorted(), 'the deck list is unchanged').toEqual(
      decksBefore,
    );
    expect(
      decksAfter.map((deck) => deck.name),
      'the model’s deck name creates nothing',
    ).not.toContain(MODEL_DECK_NAME);

    const stored = await cardsOf(page, deckId);
    expect(
      stored.every((card) => card.deck_id === deckId),
      'cards belong to the deck',
    ).toBe(true);
    expect(
      stored.map((card) => card.back).toSorted(),
      'the generated cards are stored in the deck',
    ).toEqual(CARDS.map((card) => card.back).toSorted());
    expect(
      stored.map((card) => card.front).toSorted(),
      'the generated fronts are stored in the deck',
    ).toEqual(CARDS.map((card) => card.front).toSorted());

    // The deck the user returns to shows them.
    await page.goto(`/edu/flashcards/${deckId}`);
    await expect(page.getByText('3 fiszki', { exact: true })).toBeVisible();
    // The grid renders a desktop and a mobile card; only one is on screen.
    await expect(
      page.getByText(CARDS[0].front, { exact: true }).filter({ visible: true }),
    ).toBeVisible();
  });

  test('hides the generator without ai.chat and answers a direct visit with the plan message', async ({
    page,
  }) => {
    const tenant = loadTenant(CASE);
    // The manager holds no personal plan, and the organization plan carries no
    // `ai.chat`: the same org, an account without the entitlement.
    await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage(\/|$)/ });
    const deckId = await createDeck(page, `${DECK_NAME} bez AI`);

    await page.goto(`/edu/flashcards/${deckId}`);
    // The control: this button needs the same deck.update + flashcard.create
    // pair the generator needs, so the toolbar is fully rendered for this account.
    await expect(page.getByRole('button', { name: 'Dodaj fiszkę' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Twórz z Agentem' }),
      'no ai.chat, no generator',
    ).toHaveCount(0);

    // A direct URL is refused by the page itself, not only by the missing button.
    await page.goto(`/edu/ai?deckId=${deckId}`);
    await expect(page.getByText('Asystent Q nie jest dostępny w Twoim planie')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zobacz plany' })).toBeVisible();
    await expect(page.getByPlaceholder('Zapytaj Q')).toHaveCount(0);
    expect(await fakeLlm.journal(), 'the gate refuses before any model call').toHaveLength(0);
  });
});
