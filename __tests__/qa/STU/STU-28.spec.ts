import { expect, test, type Locator, type Page } from '@playwright/test';
import { createQaSupabase } from '@qa/fixtures/qa-db';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * STU-28 — Operacje zbiorcze na fiszkach (`/app/flashcards/<id>`).
 *
 * Case: a deck with ≥ 5 flashcards plus a second deck B. Enter selection mode,
 * pick 3 flashcards, check „Zaznacz Wszystkie”, then run the bulk actions and
 * expect the documented toast for each one, the delete confirmation, and both
 * deck counters updating.
 *
 * Tenant (deterministic, `content` profile, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts STU-28 --fresh
 *
 * gives the org `qa-stu-28-<suffix>` with its manager/teacher/student; the spec
 * signs in as `users.student` — the case's deck owner. Everything else is built
 * through the product API against this tenant only: „Talia A STU-28” with 5 fiszki,
 * the empty target deck „Talia B STU-28” and the topic „Temat STU-28”. No global
 * setting, feature flag, plan, platform stat, singleton row or other tenant is
 * read or written.
 *
 * Reconciliation (walk on the shared app, 2026-10-29): the case's step 2 lists a
 * „Linkuj” action with the toast „Fiszki powiązano z taliami”. That action was
 * deliberately removed in #448 (commit d56c9448): a flashcard now has a single
 * `deck_id`, so multiple deck assignment — and the bulk link button, its dialog
 * and its endpoint — were replaced by the existing move action („Fiszki
 * przeniesiono do nowej talii”). The intended surface is the bulk bar with
 * Kopiuj / Eksportuj / Tematy / Przenieś / Usuń, which is what this spec asserts;
 * it does not encode the retired link labels.
 *
 * CI seeds that tenant once for the whole case and Playwright retries reuse it, so
 * the test first clears the student's own decks and topics: every attempt creates
 * the same content, and a retry must never find leftovers next to the new cards.
 *
 * Acceptance points asserted here:
 * 1. selection mode from the card menu, per-card selection, „Zaznacz Wszystkie” /
 *    „Odznacz Wszystkie” and the „Wybrano N” counter;
 * 2. „Tematy” (Ustaw) applies the topic to the selected flashcards („Zaktualizowano
 *    tematy dla 3 fiszek”) and the others stay untouched;
 * 3. „Kopiuj” copies to deck B („Skopiowano 3 fiszki”), source unchanged;
 * 4. „Przenieś” moves them to deck B („Fiszki przeniesiono do nowej talii”), both
 *    counters update (A 5 → 2, B 3 → 6) and the moved cards leave deck A;
 * 5. „Usuń” shows „Usunąć 2 fiszki?” + „Te fiszki zostaną trwale usunięte…”, a
 *    cancel keeps the cards, and confirming deletes them („Usunięto 2 fiszki”)
 *    leaving the empty state and a 0 counter.
 */

const CASE = 'STU-28';

const DECKS_URL = '/api/v1/flashcards/decks';
const CARDS_URL = '/api/v1/flashcards';
const TOPICS_URL = '/api/v1/flashcards/topics';

const DECK_A = { name: 'Talia A STU-28', description: 'Talia źródłowa' } as const;
const DECK_B = { name: 'Talia B STU-28', description: 'Talia docelowa' } as const;
const TOPIC_NAME = 'Temat STU-28';
const CARD_COUNT = 5;
/** The three flashcards the case operates on (the other two stay untouched). */
const PICKED = [1, 2, 3] as const;

/** Polish copy from `AppFlashcardDeckViewPage` / `Common` (pl.json). */
const COPY = {
  cardMenu: 'Więcej akcji fiszki',
  selectCards: 'Wybierz Fiszki',
  selectAll: 'Zaznacz Wszystkie',
  deselectAll: 'Odznacz Wszystkie',
  selected: (count: number) => `Wybrano ${count}`,
  barSelected: (count: number) => (count === 1 ? '1 wybrany' : `${count} wybrane`),
  barSelectedMany: (count: number) => `${count} wybranych`,
  clearSelection: 'Wyczyść zaznaczenie',
  copy: 'Kopiuj',
  move: 'Przenieś',
  topics: 'Tematy',
  delete: 'Usuń',
  update: 'Aktualizuj',
  cancel: 'Anuluj',
  topicsToast: 'Zaktualizowano tematy dla 3 fiszek',
  copyToast: 'Skopiowano 3 fiszki',
  moveToast: 'Fiszki przeniesiono do nowej talii',
  deleteToast: 'Usunięto 2 fiszki',
  deleteTitle: 'Usunąć 2 fiszki?',
  deleteDesc: 'Te fiszki zostaną trwale usunięte. Tej operacji nie można cofnąć.',
  emptyDeck: 'Nic tutaj jeszcze nie ma, stwórz swoją pierwszą fiszkę!',
  /** Polish plural of the deck counter badge (1 fiszka / 2 fiszki / 5 fiszek). */
  deckCount: (count: number) => {
    const mod10 = count % 10;
    const mod100 = count % 100;
    const few = mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14);
    return `${count} ${count === 1 ? 'fiszka' : few ? 'fiszki' : 'fiszek'}`;
  },
} as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface DeckResponse {
  id: string;
  name: string;
  flashcard_count: number;
}

interface TopicResponse {
  id: string;
  name: string;
}

interface FlashcardResponse {
  id: string;
  deck_id: string;
  front: string;
}

function cardFront(index: number): string {
  return `Fiszka A${index} STU-28`;
}

/** POST through the product API as the signed-in student. */
async function postApi<T>(page: Page, url: string, data: unknown): Promise<T> {
  const response = await page.request.post(url, { data });
  const text = await response.text();
  expect(response.ok(), `POST ${url} → ${response.status()} ${text}`).toBe(true);
  const body = JSON.parse(text) as ApiEnvelope<T>;
  expect(body.success, `POST ${url} success flag`).toBe(true);
  return body.data;
}

async function getDeck(page: Page, deckId: string): Promise<DeckResponse> {
  const response = await page.request.get(`${DECKS_URL}/${deckId}`);
  const text = await response.text();
  expect(response.ok(), `GET ${DECKS_URL}/${deckId} → ${response.status()} ${text}`).toBe(true);
  const body = JSON.parse(text) as ApiEnvelope<DeckResponse>;
  expect(body.success, `GET ${DECKS_URL}/${deckId} success flag`).toBe(true);
  return body.data;
}

/** The flashcards the signed-in student can read in one deck. */
async function getDeckCards(page: Page, deckId: string): Promise<FlashcardResponse[]> {
  const url = `${CARDS_URL}?deckIds=${deckId}&limit=50`;
  const response = await page.request.get(url);
  const text = await response.text();
  expect(response.ok(), `GET ${url} → ${response.status()} ${text}`).toBe(true);
  const body = JSON.parse(text) as ApiEnvelope<{ items: FlashcardResponse[] }>;
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data.items;
}

/** The flashcard card; its id is the card's own `id` attribute (`fc-<uuid>`). */
function card(page: Page, cardId: string): Locator {
  return page.locator(`#fc-${cardId}`);
}

/**
 * The bulk-action bar (only rendered while something is selected). Anchored on
 * the bar's own „Wyczyść zaznaczenie” control instead of its Tailwind classes, so
 * a restyle cannot silently turn every bar assertion into "0 matches".
 */
function bulkBar(page: Page): Locator {
  return page
    .locator('div')
    .filter({ has: page.getByRole('button', { name: COPY.clearSelection, exact: true }) })
    .last();
}

/** The sonner toast carrying this text. */
function toast(page: Page, text: string): Locator {
  return page.locator('[data-sonner-toast]').filter({ hasText: text });
}

/** The deck view's own counter badge under the deck name. */
function deckBadge(page: Page): Locator {
  return page
    .locator('main [data-slot="badge"]')
    .filter({ hasText: /^[0-9]+ fisz/ })
    .first();
}

/**
 * Retry-safety: CI seeds a case tenant **once** and reuses it for every retry, so
 * an attempt that dies halfway leaves its decks, cards and topic behind. The next
 * attempt would then render more cards than the case asserts. Delete only this
 * tenant student's own content (decks cascade their cards, topics cascade their
 * assignments) so every attempt starts from the same first-run state.
 */
async function resetStudentFlashcardState(tenant: QaTenant): Promise<void> {
  const student = tenant.users.student;
  if (!student) throw new Error(`${CASE} tenant has no student to reset`);
  if (!tenant.org) throw new Error(`${CASE} tenant has no organization to reset`);
  const db = createQaSupabase();

  const decks = await db
    .from('flashcard_decks')
    .delete()
    .eq('created_by', student.id)
    .eq('organization_id', tenant.org.id)
    .select('id');
  expect(
    decks.error,
    `delete ${CASE} student flashcard decks: ${decks.error?.message ?? ''}`,
  ).toBeNull();

  const topics = await db
    .from('topics')
    .delete()
    .eq('created_by', student.id)
    .eq('organization_id', tenant.org.id)
    .select('id');
  expect(topics.error, `delete ${CASE} student topics: ${topics.error?.message ?? ''}`).toBeNull();
}

/** Enter selection mode from a card's own „…” menu (it selects that card). */
async function enterSelectionMode(page: Page, cardId: string): Promise<void> {
  await card(page, cardId).getByRole('button', { name: COPY.cardMenu }).click();
  await page.getByRole('menuitem', { name: COPY.selectCards, exact: true }).click();
}

/** Click the checkboxes of the picked cards (selection mode is already on). */
async function pickCards(page: Page, cardIds: string[]): Promise<void> {
  for (const cardId of cardIds) {
    await card(page, cardId).getByRole('checkbox').click();
  }
}

test.describe('@case:STU-28 @area:STU @prio:P2 flashcard bulk operations', () => {
  test('selects, tags, copies, moves and deletes flashcards with the documented toasts and counters', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    const student = tenant.users.student;
    if (!student) throw new Error(`${CASE} needs the content tenant profile (student account)`);

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // A retry reuses this tenant, so drop whatever the previous attempt left.
    await resetStudentFlashcardState(tenant);
    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

    // --- Prerequisite: deck A with 5 cards, deck B and one topic ------------
    const deckA = await postApi<DeckResponse>(page, DECKS_URL, DECK_A);
    const deckB = await postApi<DeckResponse>(page, DECKS_URL, DECK_B);
    const topic = await postApi<TopicResponse>(page, TOPICS_URL, { name: TOPIC_NAME });
    expect(topic.name).toBe(TOPIC_NAME);

    const cards: string[] = [];
    for (let index = 1; index <= CARD_COUNT; index++) {
      const created = await postApi<FlashcardResponse>(page, CARDS_URL, {
        deckId: deckA.id,
        front: cardFront(index),
        back: `Odpowiedź A${index}`,
      });
      cards.push(created.id);
    }
    const picked = PICKED.map((index) => cards[index - 1]!);
    const untouched = cards.filter((id) => !picked.includes(id));

    await page.goto(`/app/flashcards/${deckA.id}`);
    await expect(page.getByRole('heading', { level: 2, name: DECK_A.name })).toBeVisible();
    await expect(deckBadge(page)).toHaveText(COPY.deckCount(CARD_COUNT));
    for (const cardId of cards) {
      await expect(card(page, cardId), 'every prerequisite card is rendered').toBeVisible();
    }

    // --- Step 1: „Wybierz Fiszki”, 3 cards, „Zaznacz Wszystkie” ------------
    await enterSelectionMode(page, picked[0]!);
    await expect(
      card(page, picked[0]!).getByRole('checkbox'),
      'the card whose menu entered selection mode starts selected',
    ).toBeChecked();
    await expect(page.getByText(COPY.selected(1), { exact: true })).toBeVisible();
    await expect(
      page.getByText(COPY.barSelected(1), { exact: true }),
      'the bar counts the single picked card',
    ).toBeVisible();

    await pickCards(page, picked.slice(1));
    await expect(page.getByText(COPY.selected(3), { exact: true })).toBeVisible();
    for (const cardId of picked) {
      await expect(card(page, cardId).getByRole('checkbox')).toBeChecked();
    }
    for (const cardId of untouched) {
      await expect(card(page, cardId).getByRole('checkbox')).not.toBeChecked();
    }

    await page.getByRole('button', { name: COPY.selectAll, exact: true }).click();
    await expect(page.getByText(COPY.selected(CARD_COUNT), { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: COPY.deselectAll, exact: true }),
      '„Zaznacz Wszystkie” turns into „Odznacz Wszystkie”',
    ).toBeVisible();
    await expect(
      page.getByText(COPY.barSelectedMany(CARD_COUNT), { exact: true }),
      'the bar counts all five cards',
    ).toBeVisible();
    for (const cardId of cards) {
      await expect(card(page, cardId).getByRole('checkbox')).toBeChecked();
    }

    await page.getByRole('button', { name: COPY.deselectAll, exact: true }).click();
    await expect(page.getByText(COPY.selected(0), { exact: true })).toBeVisible();
    await expect(bulkBar(page), 'no bulk bar without a selection').toHaveCount(0);
    await expect(
      page.getByRole('button', { name: COPY.selectAll, exact: true }),
      'the toggle is back to „Zaznacz Wszystkie”',
    ).toBeVisible();

    await pickCards(page, picked);
    await expect(page.getByText(COPY.selected(3), { exact: true })).toBeVisible();

    // --- Step 2a: Tematy (Ustaw) on the 3 cards -----------------------------
    await bulkBar(page).getByRole('button', { name: COPY.topics, exact: true }).click();
    const topicsDialog = page.getByRole('dialog');
    await expect(topicsDialog.getByRole('heading', { name: COPY.topics })).toBeVisible();
    await expect(
      topicsDialog.getByRole('button', { name: 'Ustaw', exact: true }),
      '„Ustaw” is the default topics operation',
    ).toBeVisible();

    const topicCheckboxes = topicsDialog.getByRole('checkbox');
    await expect(topicCheckboxes, 'the tenant topic is offered once').toHaveCount(1);
    await expect(topicsDialog.getByText(TOPIC_NAME, { exact: true })).toBeVisible();
    await topicCheckboxes.first().click();
    await expect(topicCheckboxes.first()).toBeChecked();

    await topicsDialog.getByRole('button', { name: COPY.update, exact: true }).click();
    await expect(toast(page, COPY.topicsToast), 'the „Zaktualizowano tematy…” toast').toBeVisible();
    await expect(topicsDialog, 'the topics dialog closes after saving').toHaveCount(0);
    await expect(bulkBar(page), 'the actions clear the selection').toHaveCount(0);

    for (const cardId of picked) {
      await expect(
        card(page, cardId).getByText(TOPIC_NAME, { exact: true }).filter({ visible: true }),
        'the selected flashcard carries the topic',
      ).toBeVisible();
    }
    for (const cardId of untouched) {
      await expect(
        card(page, cardId).getByText(TOPIC_NAME, { exact: true }),
        'an unselected flashcard was not tagged',
      ).toHaveCount(0);
    }

    // --- Step 2b: Kopiuj to deck B ------------------------------------------
    await enterSelectionMode(page, picked[0]!);
    await pickCards(page, picked.slice(1));
    await bulkBar(page).getByRole('button', { name: COPY.copy, exact: true }).click();

    const copyDialog = page.getByRole('dialog');
    await expect(copyDialog.getByRole('heading', { name: COPY.copy })).toBeVisible();
    const copyConfirm = copyDialog.getByRole('button', { name: COPY.copy, exact: true });
    await expect(copyConfirm, '„Kopiuj” stays disabled until a deck is picked').toBeDisabled();
    await copyDialog.getByRole('button', { name: new RegExp(DECK_B.name) }).click();
    await copyConfirm.click();

    await expect(toast(page, COPY.copyToast), 'the „Skopiowano 3 fiszki” toast').toBeVisible();
    await expect(copyDialog, 'the copy dialog closes').toHaveCount(0);
    await expect(deckBadge(page), 'copying leaves the source deck unchanged').toHaveText(
      COPY.deckCount(CARD_COUNT),
    );
    expect((await getDeck(page, deckB.id)).flashcard_count, 'deck B received the 3 copies').toBe(3);

    // --- Step 2c: Przenieś to deck B ---------------------------------------
    await enterSelectionMode(page, picked[0]!);
    await pickCards(page, picked.slice(1));
    await bulkBar(page).getByRole('button', { name: COPY.move, exact: true }).click();

    const moveDialog = page.getByRole('dialog');
    await expect(moveDialog.getByRole('heading', { name: COPY.move })).toBeVisible();
    const moveConfirm = moveDialog.getByRole('button', { name: COPY.move, exact: true });
    await expect(moveConfirm, '„Przenieś” stays disabled until a deck is picked').toBeDisabled();
    await moveDialog.getByRole('button', { name: new RegExp(DECK_B.name) }).click();
    await moveConfirm.click();

    await expect(toast(page, COPY.moveToast), 'the „Fiszki przeniesiono…” toast').toBeVisible();
    await expect(moveDialog, 'the move dialog closes').toHaveCount(0);
    await expect(deckBadge(page), 'the source counter drops to the 2 remaining cards').toHaveText(
      COPY.deckCount(2),
    );
    for (const cardId of picked) {
      await expect(card(page, cardId), 'a moved card leaves deck A').toHaveCount(0);
    }
    for (const cardId of untouched) {
      await expect(card(page, cardId), 'the untouched cards stay in deck A').toBeVisible();
    }
    expect((await getDeck(page, deckB.id)).flashcard_count, 'deck B holds 3 + 3').toBe(6);
    expect((await getDeck(page, deckA.id)).flashcard_count, 'deck A holds the 2 left').toBe(2);

    // --- Step 2d: Usuń — cancel keeps the cards -----------------------------
    await enterSelectionMode(page, untouched[0]!);
    await pickCards(page, untouched.slice(1));
    await expect(page.getByText(COPY.selected(2), { exact: true })).toBeVisible();
    await bulkBar(page).getByRole('button', { name: COPY.delete, exact: true }).click();

    const deleteDialog = page.getByRole('dialog');
    await expect(
      deleteDialog.getByRole('heading', { name: COPY.deleteTitle }),
      'the confirmation names the number of flashcards',
    ).toBeVisible();
    await expect(deleteDialog.getByText(COPY.deleteDesc, { exact: true })).toBeVisible();

    await deleteDialog.getByRole('button', { name: COPY.cancel, exact: true }).click();
    await expect(deleteDialog, '„Anuluj” closes the confirmation').toHaveCount(0);
    for (const cardId of untouched) {
      await expect(card(page, cardId), 'a cancelled delete keeps the cards').toBeVisible();
    }
    expect(
      (await getDeck(page, deckA.id)).flashcard_count,
      'a cancelled delete writes nothing',
    ).toBe(2);

    // --- Step 2d: Usuń — confirming deletes them ----------------------------
    await bulkBar(page).getByRole('button', { name: COPY.delete, exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: COPY.delete, exact: true }).click();

    await expect(toast(page, COPY.deleteToast), 'the „Usunięto 2 fiszki” toast').toBeVisible();
    await expect(deckBadge(page), 'the emptied deck reports 0').toHaveText(COPY.deckCount(0));
    await expect(page.getByText(COPY.emptyDeck, { exact: true })).toBeVisible();
    expect((await getDeck(page, deckA.id)).flashcard_count, 'deck A is empty').toBe(0);

    // --- The target deck: counter and the 6 copied/moved cards -------------
    await page.goto(`/app/flashcards/${deckB.id}`);
    await expect(page.getByRole('heading', { level: 2, name: DECK_B.name })).toBeVisible();
    await expect(deckBadge(page), 'deck B counts the 3 copies and the 3 moved cards').toHaveText(
      COPY.deckCount(6),
    );

    const deckBCards = await getDeckCards(page, deckB.id);
    expect(deckBCards, 'deck B holds exactly the copies and the moved originals').toHaveLength(6);
    expect(
      deckBCards.map((row) => row.front).sort(),
      'each picked card is present as a copy and as the moved original',
    ).toEqual([...PICKED.map(cardFront), ...PICKED.map(cardFront)].sort());
    for (const row of deckBCards) {
      await expect(card(page, row.id), 'every deck B card is rendered').toBeVisible();
    }

    expect(pageErrors, 'uncaught page errors during the bulk operations').toEqual([]);
  });
});
