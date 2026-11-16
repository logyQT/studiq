import { expect, test, type Locator, type Page } from '@playwright/test';
import { json } from '#test/helpers/json';
import { loadTenant, loginAs, type QaTenant } from '#test/qa/fixtures/tenant';

/**
 * STU-07 — Harmonogram powtórek zmienia się po ocenie.
 *
 * Case steps: rate card A „Łatwe” and card B „Nie pamiętam” in a session of new
 * cards, end it, open `/app/stats/content` („Treści”) and compare the Stan,
 * Próby, Poprawność, EF and Interwał columns of A and B.
 *
 * Tenant (deterministic, the seeder's default `content` profile, a fresh run
 * suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts STU-07 --fresh
 *
 * gives the org `qa-stu-07-<suffix>` with a manager, an educator and the student
 * under test, all ids derived from
 * `tenantKey('qa/cases/STU-07.md', 'STU-07#<suffix>', 'qa-shared')` + `tenantId`.
 * The case has no content prerequisite beyond „Sesja z kilkoma nowymi fiszkami”,
 * so the spec creates its own deck and its two cards through the product API as
 * that student: the new-card queue is then exactly those two cards. Nothing
 * global is read or written — no admin setting, feature flag, plan, platform stat
 * or singleton row — and no other tenant is touched.
 *
 * The case names no accounts, so nothing of the legacy manual seed is recreated:
 * the spec signs in as the tenant `student` and never uses `student1@dev.local`.
 *
 * Walk (2026-11-16, PR #1261 @ d2d636d9, production build on :3210, Polish UI):
 * the session of two new cards renders the learning-mode ratings („Nie pamiętam
 * (reset)” … „Łatwe (zakończ)”); rating A „Łatwe (zakończ)” and B „Nie pamiętam
 * (reset)” ends the queue and opens the summary „Sesja zakończona!” with
 * „1 z 2 poprawnych”. `/app/stats/content` then lists, newest first,
 * „W nauce | karta B | 1 | 0% | 1.70 | 1 min” and „Powtórka | karta A | 1 | 100%
 * | 2.60 | 1 dzień”; expanding a row shows „POMYŁKI” (1 for B, 0 for A) and
 * „Następna powtórka: <date> · 1 min” (B) resp. „· 1 dzień” (A).
 *
 * The case's „Pomyłki”/lapse distinction is what #809 fixed: the column must be
 * the practice log's wrong answers, not `flashcard_review_state.sm2_lapse_count`
 * (which is 0 until a card graduates, so B would read 0). The spec therefore also
 * reads B's own practice stats from the product API, where the same wrong answer
 * is `mistakeCount: 1` while the stored `sm2_lapse_count` is `0`.
 *
 * Mutation (proves this spec can fail):
 * - Product: `getAllCardStats` read the SM-2 counter again
 *   (`mistakeCount: state?.sm2_lapse_count ?? 0` — the exact #809 regression)
 *   and the app was rebuilt. Red on „B: Pomyłki”: `Expected: "1"` /
 *   `Received: "0"`, the locator resolving to `<p class="text-sm font-medium">0</p>`.
 * - Test: B rated „Dobrze” instead of „Nie pamiętam” (the wrong-answer step
 *   deleted). Red first on the summary score, then on „B: Poprawność”:
 *   `Expected: "0%"` / `Received: "100%"` — the step is not scenery.
 */

const CASE = 'STU-07';

const COPY = {
  startLearning: 'Rozpocznij naukę',
  revealHint: 'Kliknij, aby odkryć odpowiedź',
  summaryTitle: 'Sesja zakończona!',
  summaryScore: '1 z 2 poprawnych',
  backToReview: 'Powrót do przeglądu',
  statsTitle: 'Treści',
  mistakes: 'Pomyłki',
  nextReview: /^Następna powtórka: /,
} as const;

/** The case's two cards and the rating each one takes (case step 1). */
const CARDS = [
  {
    front: 'STU-07 karta A',
    back: 'STU-07 odpowiedź A',
    /** Prefix of the learning-mode button label: „Łatwe (zakończ)”. */
    rating: 'Łatwe',
    wasCorrect: true,
    state: 'review',
    intervalUnit: 'days',
  },
  {
    front: 'STU-07 karta B',
    back: 'STU-07 odpowiedź B',
    rating: 'Nie pamiętam',
    wasCorrect: false,
    state: 'learning',
    intervalUnit: 'minutes',
  },
] as const;

/** The table's columns, in the case's order (the last cell is the expand button). */
const COLUMNS = ['Stan', 'Przód', 'Próby', 'Poprawność', 'EF', 'Interwał'] as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface DeckItem {
  id: string;
  name: string;
}

interface FlashcardItem {
  id: string;
  front: string;
}

interface CardPracticeStats {
  totalAttempts: number;
  correctRate: number;
  mistakeCount: number;
  /** The raw `flashcard_review_state` row (`getStatsForFlashcard` returns it as stored). */
  reviewState: {
    learning_state: string;
    easiness_factor: number;
    interval_days: number;
    interval_unit: string;
    sm2_lapse_count: number;
  } | null;
}

/** `GET` an endpoint as the signed-in student and unwrap the response envelope. */
async function getData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.ok(), `GET ${url} → ${response.status()} ${await response.text()}`).toBe(true);
  const body = await json<ApiEnvelope<T>>(response);
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data;
}

/** The case's deck, named after the tenant's run suffix so runs never share it. */
function deckName(tenant: QaTenant): string {
  return `STU-07 harmonogram ${tenant.runSuffix ?? 'stable'}`;
}

async function ensureDeck(page: Page, name: string): Promise<DeckItem> {
  const decks = await getData<{ items: DeckItem[] }>(page, '/api/v1/flashcards/decks?limit=200');
  const existing = decks.items.find((deck) => deck.name === name);
  if (existing) return existing;

  const response = await page.request.post('/api/v1/flashcards/decks', {
    data: { name, visibility: 'personal' },
  });
  expect(
    response.status(),
    `POST /api/v1/flashcards/decks (${name}) → ${response.status()} ${await response.text()}`,
  ).toBe(201);
  return (await json<ApiEnvelope<DeckItem>>(response)).data;
}

/** The deck's two cards, keyed by front; created only when missing. */
async function ensureCards(page: Page, deckId: string): Promise<Map<string, string>> {
  const cards = await getData<{ items: FlashcardItem[] }>(
    page,
    `/api/v1/flashcards?deckIds=${deckId}&limit=100`,
  );
  const byFront = new Map(cards.items.map((card) => [card.front, card.id]));

  for (const card of CARDS) {
    if (byFront.has(card.front)) continue;
    const response = await page.request.post('/api/v1/flashcards', {
      data: { deckId, front: card.front, back: card.back },
    });
    expect(
      response.status(),
      `POST /api/v1/flashcards (${card.front}) → ${response.status()} ${await response.text()}`,
    ).toBe(201);
    byFront.set(card.front, (await json<ApiEnvelope<FlashcardItem>>(response)).data.id);
  }

  expect([...byFront.keys()].toSorted(), 'the deck holds the case’s two cards').toEqual(
    CARDS.map((card) => card.front).toSorted(),
  );
  return byFront;
}

/** `FlashcardFlip`'s rotating container (`transform-style: preserve-3d`). */
function rotatingCard(page: Page): Locator {
  return page.locator('div[style*="preserve-3d"]').first();
}

/** The front of the card currently up, or `null` while the flip animates it away. */
async function readFront(page: Page): Promise<string | null> {
  try {
    const text = await rotatingCard(page).innerText();
    return CARDS.find((card) => text.includes(card.front))?.front ?? null;
  } catch {
    return null;
  }
}

async function shownFront(page: Page): Promise<string> {
  const front = await readFront(page);
  expect(front, 'one of the case’s cards is on screen').not.toBeNull();
  return front!;
}

/**
 * Reveal the card and give it its case rating, in whatever order the shuffled
 * queue presents the two cards. Leaves the last card's summary to the caller.
 */
async function rateBothCards(page: Page): Promise<void> {
  for (let index = 0; index < CARDS.length; index += 1) {
    const front = await shownFront(page);
    const current = CARDS.find((candidate) => candidate.front === front);
    if (!current) throw new Error(`unexpected card on screen: ${front}`);

    await expect(page.getByText(COPY.revealHint, { exact: true })).toBeVisible();
    await rotatingCard(page).click();
    await expect(
      page.getByText(COPY.revealHint, { exact: true }),
      'the flip reveals the answer',
    ).toHaveCount(0);

    await page.getByRole('button', { name: new RegExp(`^${current.rating}`) }).click();

    if (index < CARDS.length - 1) {
      // Two cards: the only one left is the other card.
      const next = CARDS.find((candidate) => candidate.front !== front);
      await expect
        .poll(() => readFront(page), { message: 'the session advances to the other card' })
        .toBe(next?.front ?? null);
    }
  }
}

/** The table row whose „Przód” cell is exactly this card (not its expanded detail). */
function cardRow(page: Page, front: string): Locator {
  return page.getByRole('row').filter({
    has: page.getByRole('cell', { name: front, exact: true }),
  });
}

/** The expanded detail row directly under a card's table row. */
function cardDetail(row: Locator): Locator {
  return row.locator('xpath=following-sibling::tr[1]');
}

/** A label/value pair inside the expanded detail (the `<p>` after the label). */
function detailValue(detail: Locator, label: string): Locator {
  return detail.getByText(label, { exact: true }).locator('xpath=following-sibling::p[1]');
}

test.describe('@case:STU-07 @area:STU @prio:P1 review schedule follows the rating', () => {
  test('„Łatwe” and „Nie pamiętam” move the schedule, the state and the mistake count', async ({
    page,
  }) => {
    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} runs on the content tenant profile`).toBe('content');
    if (!tenant.users.student)
      throw new Error(`${CASE} needs the content tenant profile (student)`);

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
    const cardIds = await ensureCards(page, (await ensureDeck(page, deckName(tenant))).id);

    // --- Prerequisite: a session of the tenant's two new cards --------------
    await page.goto('/app/study');
    await expect(page).toHaveURL(/\/app\/study(\/learn)?$/);
    await page.getByRole('button', { name: COPY.startLearning, exact: true }).click();
    await expect(page).toHaveURL(/\/app\/study\/session\/new/);
    await expect(rotatingCard(page)).toBeVisible();
    // The session listens on `window`; the start button must not keep focus.
    await page.evaluate(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
    });

    // --- Step 1: rate A „Łatwe”, B „Nie pamiętam” ---------------------------
    await rateBothCards(page);

    // The summary proves both ratings reached the session as the case's 1/4
    // pair: „Nie pamiętam” is a wrong answer, „Łatwe” is a correct one.
    await expect(
      page.getByText(COPY.summaryTitle, { exact: true }),
      'the queue is exhausted and the session summary opens',
      // The summary waits for the practice batch plus the session-complete POST.
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(COPY.summaryScore, { exact: true })).toBeVisible();

    // --- Step 2: end the session, open „Treści” ----------------------------
    await page.getByRole('button', { name: COPY.backToReview, exact: true }).click();
    await expect(page).toHaveURL(/\/app\/study(\/learn)?$/);

    await page.goto('/app/stats/content');
    await expect(page).toHaveURL(/\/app\/stats\/content$/);
    await expect(page.getByRole('heading', { level: 1, name: COPY.statsTitle })).toBeVisible();
    await expect(
      page.locator('table thead th'),
      'the table exposes the columns the case compares',
    ).toHaveText([...COLUMNS, '']);

    // --- Step 3: compare the two cards' columns ----------------------------
    // Find each row by the card it describes rather than by its position.
    const rowA = cardRow(page, CARDS[0].front);
    const rowB = cardRow(page, CARDS[1].front);

    await expect(rowA.getByRole('cell').nth(0), 'A: Stan').toHaveText('Powtórka');
    await expect(rowA.getByRole('cell').nth(2), 'A: Próby').toHaveText('1');
    await expect(rowA.getByRole('cell').nth(3), 'A: Poprawność').toHaveText('100%');
    await expect(rowA.getByRole('cell').nth(4), 'A: EF').toHaveText('2.60');
    await expect(rowA.getByRole('cell').nth(5), 'A: Interwał').toHaveText('1 dzień');

    await expect(rowB.getByRole('cell').nth(0), 'B: Stan').toHaveText('W nauce');
    await expect(rowB.getByRole('cell').nth(2), 'B: Próby').toHaveText('1');
    await expect(rowB.getByRole('cell').nth(3), 'B: Poprawność').toHaveText('0%');
    await expect(rowB.getByRole('cell').nth(4), 'B: EF').toHaveText('1.70');
    await expect(rowB.getByRole('cell').nth(5), 'B: Interwał').toHaveText('1 min');

    // --- Expected result: B's mistake and both next reviews ----------------
    // „Pomyłki” is the practice log's wrong answer, not the SM-2 lapse counter.
    await rowA.click();
    const detailA = cardDetail(rowA);
    await expect(detailA).toBeVisible();
    await expect(detailValue(detailA, COPY.mistakes), 'A: Pomyłki').toHaveText('0');
    await expect(
      detailA.getByText(COPY.nextReview),
      'A: the „Łatwe” rating graduates the card to a one-day review',
    ).toContainText('· 1 dzień');

    await rowB.click();
    const detailB = cardDetail(rowB);
    await expect(detailB).toBeVisible();
    await expect(detailValue(detailB, COPY.mistakes), 'B: Pomyłki').toHaveText('1');
    await expect(
      detailB.getByText(COPY.nextReview),
      'B: the „Nie pamiętam” rating schedules the learning step, not a day',
    ).toContainText('· 1 min');

    // --- The persisted rows behind the two columns -------------------------
    // The per-card practice stats keep the case's distinction visible: B's wrong
    // answer is a practice mistake while the SM-2 lapse counter stays 0 (the
    // counter #809 renamed and stopped using for „Pomyłki”).
    for (const card of CARDS) {
      const id = cardIds.get(card.front);
      expect(id, `card id for ${card.front}`).toBeTruthy();
      const stats = await getData<CardPracticeStats>(
        page,
        `/api/v1/flashcards/${id}/practice/stats`,
      );

      expect(stats.totalAttempts, `${card.front}: practice rows`).toBe(1);
      expect(stats.correctRate, `${card.front}: correct-rate`).toBe(card.wasCorrect ? 100 : 0);
      expect(stats.mistakeCount, `${card.front}: practice-log mistakes`).toBe(
        card.wasCorrect ? 0 : 1,
      );
      expect(stats.reviewState, `${card.front}: the rating wrote a review state`).not.toBeNull();
      expect(stats.reviewState?.sm2_lapse_count, `${card.front}: SM-2 lapses`).toBe(0);
      expect(stats.reviewState?.interval_unit, `${card.front}: interval unit`).toBe(
        card.intervalUnit,
      );
      expect(stats.reviewState?.learning_state, `${card.front}: learning state`).toBe(card.state);
    }

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });
});
