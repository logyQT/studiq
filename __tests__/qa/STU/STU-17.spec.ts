import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

/**
 * STU-17 — Zawieszanie talii (`/app/flashcards`).
 *
 * Case steps: suspend a deck from „Zawieś talię”, check the list with
 * „Pokaż zawieszone”, start a „Ucz się” session, then restore the deck with
 * „Przywróć talię”.
 *
 * Tenant (deterministic, `content` profile, a fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts STU-17 --fresh
 *
 * gives the org `qa-stu-17-<suffix>` with a manager, an educator and the student
 * under test, plus the default group `G1` — every id derived from
 * `tenantKey('qa/cases/STU-17.md', 'STU-17#<suffix>', 'qa-shared')` +
 * `tenantId(key, entity)`. The case's prerequisite („Własna talia z fiszkami”) is
 * built by the spec inside that same tenant: the student creates one personal deck
 * with three cards through the product API (`flashcard.create` = `own`), the same
 * way the legacy seed's personal deck `O1S1` maps onto this tenant. Nothing global
 * is read or written — no admin setting, feature flag, plan, platform stat or
 * singleton row, and no other tenant.
 *
 * Acceptance points (confirmed in the walk on the shared app :3010, Polish UI):
 * 1. „Zawieś talię” raises the toast „Talia zawieszona” and the deck leaves the
 *    default list.
 * 2. „Pokaż zawieszone” (the eye-off toolbar toggle, icon-only while off) brings
 *    it back with the „Zawieszona” badge and its card counter.
 * 3. The deck view carries „Ta talia jest zawieszona. Fiszki z tej talii nie będą
 *    wyświetlane w sesjach nauki ani statystykach.”.
 * 4. The „Ucz się” surface ignores the deck: the learn page shows
 *    „Wszystko powtórzone!” instead of a start button, the new/review queues are
 *    empty, and the statistics breakdown reports zero cards.
 * 5. „Przywróć talię” raises „Talia przywrócona”, drops the badge and the notice,
 *    and the deck's cards are offered for study again.
 *
 * The cram endpoint (`practice/prepare`) is deliberately **not** asserted here:
 * suspension is enforced on the study queues (`practice/new`, `practice/review`)
 * and on statistics, which is the surface the case describes; cram is picked from
 * the deck list, which hides suspended decks.
 */

const CASE = 'STU-17';

const COPY = {
  suspendDeck: 'Zawieś talię',
  unsuspendDeck: 'Przywróć talię',
  deckSuspendedToast: 'Talia zawieszona',
  deckUnsuspendedToast: 'Talia przywrócona',
  suspendedBadge: 'Zawieszona',
  showSuspended: 'Pokaż zawieszone',
  suspendedNotice:
    'Ta talia jest zawieszona. Fiszki z tej talii nie będą wyświetlane w sesjach nauki ani statystykach.',
  allCaughtUp: 'Wszystko powtórzone!',
  allCaughtUpDesc: 'Brak fiszek do powtórki i brak nowych kart. Wróć później!',
  newCardsTitle: 'Nowe karty',
  newCardsAvailable: 'nowe karty dostępne do nauki',
  startLearning: 'Rozpocznij naukę',
} as const;

const DECK_NAME = 'STU-17 talia';
const CARD_FRONTS = ['STU-17 pytanie A', 'STU-17 pytanie B', 'STU-17 pytanie C'] as const;

const DECKS_URL = '/api/v1/flashcards/decks';
const CARDS_URL = '/api/v1/flashcards';

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface DeckListItem {
  id: string;
  name: string;
  suspended?: boolean;
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

interface SessionCard {
  id: string;
  front: string;
  deckName?: string | null;
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

/**
 * `GET /api/v1/flashcards/decks` — the list the deck screen renders. Without
 * `includeSuspended` it mirrors the default view (suspended decks excluded);
 * with it, it mirrors the „Pokaż zawieszone” view and reports each deck's flag.
 */
async function listDecks(
  page: Page,
  options: { includeSuspended?: boolean } = {},
): Promise<DeckListResult> {
  const include = options.includeSuspended ? '&includeSuspended=true' : '';
  return getData<DeckListResult>(page, `${DECKS_URL}?limit=200${include}`);
}

/** The deck's cards, read through the deck view's list endpoint. */
async function listCards(page: Page, deckId: string): Promise<FlashcardRow[]> {
  const result = await getData<{ items: FlashcardRow[] }>(
    page,
    `${CARDS_URL}?deckIds=${deckId}&limit=100`,
  );
  return result.items;
}

/** The deck the case suspends, created once per tenant through the product API. */
async function ensureDeck(page: Page): Promise<DeckListItem> {
  const existing = (await listDecks(page)).items.find((deck) => deck.name === DECK_NAME);
  if (existing) return existing;

  const response = await page.request.post(DECKS_URL, {
    data: { name: DECK_NAME, visibility: 'personal' },
  });
  expect(
    response.status(),
    `POST ${DECKS_URL} → ${response.status()} ${await response.text()}`,
  ).toBe(201);
  const body = (await response.json()) as ApiEnvelope<DeckListItem>;
  expect(body.success, `POST ${DECKS_URL} success flag`).toBe(true);
  return body.data;
}

/** Add a card unless its front already exists, so a re-run stays idempotent. */
async function ensureCard(page: Page, deckId: string, front: string, back: string): Promise<void> {
  if ((await listCards(page, deckId)).some((card) => card.front === front)) return;

  const response = await page.request.post(CARDS_URL, {
    data: { deckId, front, back },
  });
  expect(
    response.status(),
    `POST ${CARDS_URL} (${front}) → ${response.status()} ${await response.text()}`,
  ).toBe(201);
}

/** The deck's cards as the „Ucz się” queue would serve them right now. */
async function newCardQueue(page: Page): Promise<SessionCard[]> {
  return getData<SessionCard[]>(page, '/api/v1/flashcards/practice/new?limit=20');
}

/** The review queue, which must stay empty while the deck is suspended. */
async function reviewQueue(page: Page): Promise<SessionCard[]> {
  return getData<SessionCard[]>(page, '/api/v1/flashcards/practice/review?limit=20');
}

/** The statistics breakdown („Statystyki → Treści”) for the signed-in student. */
async function statistics(page: Page): Promise<StateBreakdown> {
  return getData<StateBreakdown>(page, '/api/v1/flashcards/practice/states');
}

/** The deck card on the list screen, matched by its heading. */
function deckCard(page: Page, name: string): Locator {
  return page.locator('[data-slot="card"]').filter({
    has: page.getByRole('heading', { name, exact: true }),
  });
}

/** The list-screen context menu trigger for a deck (mobile and desktop both render). */
function deckMenuTrigger(page: Page, name: string): Locator {
  return page
    .getByRole('button', { name: `Więcej akcji: ${name}`, exact: true })
    .filter({ visible: true });
}

/**
 * The „Pokaż zawieszone” toolbar toggle. It is icon-only while off (copy appears
 * only once it is on), so the eye-off icon is the stable handle.
 */
function showSuspendedToggle(page: Page): Locator {
  return page.locator('button:has(svg.lucide-eye-off)').filter({ visible: true });
}

/** The tooltip-less action that flips a deck's suspended state from the list. */
async function toggleSuspendFromList(page: Page, name: string, action: string): Promise<void> {
  await deckMenuTrigger(page, name).click();
  const item = page.getByRole('menuitem', { name: action, exact: true });
  await expect(item, `„${action}” in the deck menu`).toBeVisible();
  await item.click();
}

test.describe('@case:STU-17 @area:STU @prio:P2 suspend and restore a deck', () => {
  test('suspends a deck out of the list, sessions and statistics, then restores it', async ({
    page,
  }) => {
    test.setTimeout(150_000);

    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} runs on the content tenant profile`).toBe('content');
    expect(
      tenant.runSuffix,
      'seed with --fresh: every independent run owns a new tenant',
    ).toBeTruthy();
    expect(tenant.org, `${CASE} needs an organization`).not.toBeNull();
    const student = tenant.users.student;
    expect(student, `${CASE} seeds the student under test`).toBeTruthy();

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // ── Precondition: a signed-in student with its own deck and cards ──────
    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
    await expect(page).toHaveURL(/\/app$/);

    const deck = await ensureDeck(page);
    for (const front of CARD_FRONTS) {
      await ensureCard(page, deck.id, front, `STU-17 odpowiedź ${front.slice(-1)}`);
    }

    const tenantDecks = await listDecks(page);
    expect(tenantDecks.total, 'the tenant holds exactly the deck this case creates').toBe(1);
    expect(tenantDecks.items[0].id).toBe(deck.id);
    expect(tenantDecks.items[0].flashcard_count).toBe(CARD_FRONTS.length);
    expect(tenantDecks.items[0].suspended, 'the fresh deck is not suspended').toBe(false);

    // Baseline: the deck's cards are the whole „Ucz się” queue and are counted
    // by the statistics breakdown.
    const queueBefore = await newCardQueue(page);
    expect(
      queueBefore.map((card) => card.front).sort(),
      'the deck feeds the study queue before suspension',
    ).toEqual([...CARD_FRONTS].sort());
    const statsBefore = await statistics(page);
    expect(statsBefore.totalCards, 'the cards are in the statistics before suspension').toBe(
      CARD_FRONTS.length,
    );

    await page.goto('/app/flashcards');
    await expect(page).toHaveURL(/\/app\/flashcards$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
    await expect(
      deckCard(page, DECK_NAME).getByText(`${CARD_FRONTS.length} fiszki`, { exact: true }).filter({
        visible: true,
      }),
      'the deck card shows its card counter',
    ).toHaveCount(1);

    // ── Step 1: „Zawieś talię” ─────────────────────────────────────────────
    await toggleSuspendFromList(page, DECK_NAME, COPY.suspendDeck);
    await expect(
      page.getByText(COPY.deckSuspendedToast, { exact: true }),
      'the suspend confirmation toast',
    ).toBeVisible();

    // The deck leaves the default list…
    await expect(deckCard(page, DECK_NAME), 'a suspended deck is hidden by default').toHaveCount(0);
    const hiddenFromList = await listDecks(page);
    expect(hiddenFromList.total, 'the default deck list hides the suspended deck').toBe(0);

    // ── Step 2: „Pokaż zawieszone” ─────────────────────────────────────────
    const toggle = showSuspendedToggle(page);
    await expect(toggle, 'the „Pokaż zawieszone” toggle is offered').toHaveCount(1);
    await toggle.click();
    await expect(
      showSuspendedToggle(page),
      'the toggle reveals its „Pokaż zawieszone” label once on',
    ).toHaveText(COPY.showSuspended);

    const suspendedCard = deckCard(page, DECK_NAME);
    await expect(suspendedCard, 'the suspended deck is listed once shown').toBeVisible();
    await expect(
      suspendedCard.getByText(COPY.suspendedBadge, { exact: true }).filter({ visible: true }),
      'the suspended deck carries the „Zawieszona” badge',
    ).toHaveCount(1);
    await expect(
      suspendedCard
        .getByText(`${CARD_FRONTS.length} fiszki`, { exact: true })
        .filter({ visible: true }),
      'the badge does not replace the card counter',
    ).toHaveCount(1);

    const shownDecks = await listDecks(page, { includeSuspended: true });
    expect(
      shownDecks.items.find((item) => item.id === deck.id)?.suspended,
      'the deck list reports the per-user suspended flag',
    ).toBe(true);

    // ── Expected result: the deck view carries the suspension notice ───────
    await suspendedCard.getByRole('button', { name: 'Zarządzaj', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/app/flashcards/${deck.id}$`));
    await expect(
      page.getByText(COPY.suspendedNotice, { exact: true }),
      'the deck view explains what suspension means',
    ).toBeVisible();
    await expect(
      page.getByText(CARD_FRONTS[0], { exact: true }).filter({ visible: true }).first(),
      'the cards stay visible inside the suspended deck',
    ).toBeVisible();

    // ── Step 3: „Ucz się” ignores the suspended deck ───────────────────────
    await page.goto('/app/study/learn');
    await expect(page).toHaveURL(/\/app\/study\/learn$/);
    await expect(
      page.getByText(COPY.allCaughtUp, { exact: true }),
      'the learn page reports nothing to study',
    ).toBeVisible();
    await expect(page.getByText(COPY.allCaughtUpDesc, { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: COPY.startLearning, exact: true }),
      'no study session can be started from the suspended deck',
    ).toHaveCount(0);

    expect(await newCardQueue(page), 'the new-card queue skips suspended cards').toEqual([]);
    expect(await reviewQueue(page), 'the review queue skips suspended cards').toEqual([]);
    expect((await statistics(page)).totalCards, 'statistics skip suspended cards').toBe(0);

    // ── Step 4: „Przywróć talię” ───────────────────────────────────────────
    // Back on the deck screen (where the case's suspend/restore actions live and
    // where the product confirms them with a toast).
    await page.goto('/app/flashcards');
    await showSuspendedToggle(page).click();
    await expect(
      deckCard(page, DECK_NAME),
      'the suspended deck is listed again for the restore step',
    ).toBeVisible();

    await toggleSuspendFromList(page, DECK_NAME, COPY.unsuspendDeck);
    await expect(
      page.getByText(COPY.deckUnsuspendedToast, { exact: true }),
      'the restore confirmation toast',
    ).toBeVisible();
    await expect(
      deckCard(page, DECK_NAME).getByText(COPY.suspendedBadge, { exact: true }),
      'the „Zawieszona” badge is gone right after the restore',
    ).toHaveCount(0);
    expect(
      (await listDecks(page, { includeSuspended: true })).items.find((item) => item.id === deck.id)
        ?.suspended,
      'the deck list reports the deck as active again',
    ).toBe(false);

    // The suspension notice is gone from the deck view as well.
    await page.goto(`/app/flashcards/${deck.id}`);
    await expect(
      page.getByText(COPY.suspendedNotice, { exact: true }),
      'the suspension notice disappears once restored',
    ).toHaveCount(0);

    // The deck is back in the default list without the badge.
    await page.goto('/app/flashcards');
    const restoredCard = deckCard(page, DECK_NAME);
    await expect(restoredCard, 'the restored deck returns to the default list').toBeVisible();
    await expect(
      restoredCard.getByText(COPY.suspendedBadge, { exact: true }),
      'the „Zawieszona” badge is gone after restore',
    ).toHaveCount(0);
    expect(
      (await listDecks(page)).items.find((item) => item.id === deck.id)?.suspended,
      'the deck list reports the deck as active again',
    ).toBe(false);

    // The cards return to study and to the statistics.
    await expect
      .poll(async () => (await newCardQueue(page)).length, {
        message: 'the restored deck feeds the study queue again',
      })
      .toBe(CARD_FRONTS.length);
    expect(
      (await newCardQueue(page)).map((card) => card.front).sort(),
      'the whole deck is offered for study again',
    ).toEqual([...CARD_FRONTS].sort());
    expect((await statistics(page)).totalCards, 'the cards are counted again').toBe(
      CARD_FRONTS.length,
    );

    await page.goto('/app/study/learn');
    await expect(page.getByText(COPY.newCardsTitle, { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: COPY.startLearning, exact: true }),
      'the student can start learning again',
    ).toBeVisible();
    await expect(
      page.getByText(COPY.allCaughtUp, { exact: true }),
      'the „all caught up” state is gone after restore',
    ).toHaveCount(0);

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });
});
