import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * STU-27 — Usuwanie fiszki w widoku talii (`/app/flashcards/<id>`).
 *
 * Case: „Usuń” przy fiszce → potwierdź. Expected: okno „Usunąć Fiszkę?” z opisem
 * „To trwale usunie fiszkę. Tej akcji nie można cofnąć.”, a po potwierdzeniu toast
 * „Fiszka usunięta”.
 *
 * Tenant (deterministic, `content` profile, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts STU-27 --fresh
 *
 * gives the org `qa-stu-27-<suffix>` with a manager, an educator and the student this
 * case signs in as — every id derived from `tenantKey('qa/cases/STU-27.md',
 * 'STU-27#<suffix>', 'qa-shared')`. The case's prerequisite („Talia z fiszką”, the
 * legacy `student1@dev.local` deck `O1S1`) maps onto that student: the spec creates its
 * own deck and two cards through the product API and drives the UI on the deck view.
 * Nothing global is read or written — no admin setting, feature flag, plan, platform
 * stat or singleton row — and no other tenant.
 *
 * The walk on the shared app (:3010, Polish UI, worker qa-env-4) confirmed:
 * - The delete action lives in the card's overflow menu, not on the card: the ⋮ button
 *   „Więcej akcji fiszki” (revealed on hover) opens a menu whose last, destructive entry
 *   is „Usuń”.
 * - That opens the confirmation dialog from `DeleteConfirmDialog`: title „Usunąć
 *   Fiszkę?”, description „To trwale usunie fiszkę. Tej akcji nie można cofnąć.”,
 *   actions „Anuluj” / „Usuń” (plus the dialog's ✕ close button).
 * - Confirming closes the dialog, raises the toast „Fiszka usunięta”, removes exactly
 *   that card from the grid, decrements the deck badge („2 fiszki” → „1 fiszka”) and
 *   leaves the other card alone; the deletion survives a reload.
 * - „Anuluj” closes the dialog without deleting: the card stays, no toast, and the API
 *   still returns the deck's cards.
 * - API: `DELETE /api/v1/flashcards/<id>` → 200; the card disappears from
 *   `GET /api/v1/flashcards?deckIds=<deck>` and a repeat delete → 404.
 */

const CASE = 'STU-27';

const FLASHCARDS_URL = '/api/v1/flashcards';
const DECKS_URL = '/api/v1/flashcards/decks';

/** Polish copy from `AppFlashcardDeckViewPage` (pl.json) and the walk. */
const COPY = {
  moreActions: 'Więcej akcji fiszki',
  menuDelete: 'Usuń',
  dialogTitle: 'Usunąć Fiszkę?',
  dialogDesc: 'To trwale usunie fiszkę. Tej akcji nie można cofnąć.',
  cancel: 'Anuluj',
  confirm: 'Usuń',
  deleted: 'Fiszka usunięta',
  twoCards: '2 fiszki',
  oneCard: '1 fiszka',
} as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface DeckRow {
  id: string;
  name: string;
  flashcard_count: number;
}

interface CardRow {
  id: string;
  deck_id: string;
  front: string;
  back: string;
}

interface CardList {
  items: CardRow[];
  total: number;
}

function studentOf(tenant: QaTenant): NonNullable<QaTenant['users']['student']> {
  const student = tenant.users.student;
  if (!student) throw new Error(`${CASE} needs the content tenant profile (student account)`);
  return student;
}

/** The run's own deck name, so two attempts never share a deck. */
function deckName(tenant: QaTenant): string {
  return `STU-27 usuwanie ${tenant.runSuffix ?? tenant.key.slice(-6)}`;
}

/** The card the case deletes, and the one that must survive it. */
function cardContent(tenant: QaTenant): {
  doomed: { front: string; back: string };
  kept: { front: string; back: string };
} {
  const run = tenant.runSuffix ?? tenant.key.slice(-6);
  return {
    doomed: { front: `Pytanie do usunięcia ${run}`, back: `Odpowiedź do usunięcia ${run}` },
    kept: { front: `Pytanie zostaje ${run}`, back: `Odpowiedź zostaje ${run}` },
  };
}

/** Create the prerequisite deck („Talia z fiszką”) through the product API. */
async function createDeck(page: Page, tenant: QaTenant): Promise<DeckRow> {
  const response = await page.request.post(DECKS_URL, { data: { name: deckName(tenant) } });
  expect(
    response.status(),
    `POST ${DECKS_URL} → ${response.status()} ${await response.text()}`,
  ).toBe(201);
  const body = (await response.json()) as ApiEnvelope<DeckRow>;
  expect(body.success, 'POST deck success flag').toBe(true);
  expect(body.data.flashcard_count, 'the fresh deck starts empty').toBe(0);
  return body.data;
}

async function createCard(
  page: Page,
  deckId: string,
  content: { front: string; back: string },
): Promise<CardRow> {
  const response = await page.request.post(FLASHCARDS_URL, {
    data: { deckId, front: content.front, back: content.back },
  });
  expect(
    response.status(),
    `POST ${FLASHCARDS_URL} → ${response.status()} ${await response.text()}`,
  ).toBe(201);
  const body = (await response.json()) as ApiEnvelope<CardRow>;
  expect(body.success, 'POST flashcard success flag').toBe(true);
  expect(body.data.deck_id, 'the card belongs to this deck').toBe(deckId);
  return body.data;
}

/** Every card the API returns for this deck. */
async function listCards(page: Page, deckId: string): Promise<CardRow[]> {
  const response = await page.request.get(`${FLASHCARDS_URL}?deckIds=${deckId}&limit=50`);
  expect(response.status(), `GET ${FLASHCARDS_URL}?deckIds=${deckId}`).toBe(200);
  return ((await response.json()) as ApiEnvelope<CardList>).data.items;
}

/** The deck's own card in the grid, addressed by the id the API assigned. */
function flashcardCard(page: Page, cardId: string): Locator {
  return page.locator(`#fc-${cardId}`);
}

/** The newest sonner toast carrying this text. */
function toast(page: Page, text: string): Locator {
  return page.locator('[data-sonner-toast]').filter({ hasText: text }).last();
}

/**
 * `FlashcardCard` renders a mobile row and a desktop row in the same DOM node; only
 * one of the two overflow buttons is laid out, so the visible one is the real trigger.
 */
function cardMenuTrigger(card: Locator): Locator {
  return card.locator('button').filter({ visible: true }).first();
}

/** Open the card's „Usuń” action and return the confirmation dialog. */
async function openDeleteDialog(page: Page, card: Locator): Promise<Locator> {
  await cardMenuTrigger(card).click();
  const menuItem = page.getByRole('menuitem', { name: COPY.menuDelete, exact: true });
  await expect(menuItem, 'the card menu offers „Usuń”').toBeVisible();
  await menuItem.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: COPY.dialogTitle })).toBeVisible();
  return dialog;
}

test.describe('@case:STU-27 @area:STU @prio:P2 delete a flashcard', () => {
  test('deletes the chosen flashcard after confirming the “Usunąć Fiszkę?” dialog', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    studentOf(tenant);

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

    // --- Prerequisite: „Talia z fiszką” (deck with two cards) --------------
    const content = cardContent(tenant);
    const deck = await createDeck(page, tenant);
    const doomed = await createCard(page, deck.id, content.doomed);
    const kept = await createCard(page, deck.id, content.kept);

    const response = await page.goto(`/app/flashcards/${deck.id}`);
    expect(response?.status(), `GET /app/flashcards/${deck.id}`).toBe(200);
    await expect(page.getByRole('heading', { name: deckName(tenant) })).toBeVisible();
    await expect(
      page.locator('[data-slot="badge"]:visible').filter({ hasText: COPY.twoCards }),
      'the deck badge counts both cards',
    ).toHaveCount(1);

    const doomedCard = flashcardCard(page, doomed.id);
    const keptCard = flashcardCard(page, kept.id);
    await expect(doomedCard, 'the card to delete is in the deck').toBeVisible();
    await expect(doomedCard).toContainText(content.doomed.front);
    await expect(keptCard, 'the other card is in the deck').toBeVisible();
    await expect(keptCard).toContainText(content.kept.front);

    // --- Step 1: „Usuń” przy fiszce, potem potwierdzenie --------------------
    let dialog = await openDeleteDialog(page, doomedCard);

    // The whole dialog copy from the case, verbatim.
    await expect(
      dialog.getByText(COPY.dialogDesc, { exact: true }),
      'the dialog warns that the action is permanent',
    ).toBeVisible();
    const confirm = dialog.getByRole('button', { name: COPY.confirm, exact: true });
    const cancel = dialog.getByRole('button', { name: COPY.cancel, exact: true });
    await expect(confirm, 'the dialog has a „Usuń” action').toBeVisible();
    await expect(cancel, 'the dialog has an „Anuluj” action').toBeVisible();

    // Adjacent regression: cancelling deletes nothing and raises no toast.
    await cancel.click();
    await expect(dialog, '„Anuluj” closes the dialog').toHaveCount(0);
    await expect(doomedCard, '„Anuluj” keeps the card').toBeVisible();
    await expect(toast(page, COPY.deleted), '„Anuluj” raises no toast').toHaveCount(0);
    expect(await listCards(page, deck.id), '„Anuluj” deletes nothing').toHaveLength(2);

    // Confirm for real.
    dialog = await openDeleteDialog(page, doomedCard);
    await dialog.getByRole('button', { name: COPY.confirm, exact: true }).click();

    // --- Expected result: toast „Fiszka usunięta” ---------------------------
    await expect(toast(page, COPY.deleted), 'the „Fiszka usunięta” toast').toBeVisible();
    await expect(dialog, 'the dialog closes after confirming').toHaveCount(0);

    // Only the chosen card is gone; the other one is untouched.
    await expect(doomedCard, 'the deleted card leaves the deck').toHaveCount(0);
    await expect(page.getByText(content.doomed.front, { exact: false })).toHaveCount(0);
    await expect(keptCard, 'the other card stays in the deck').toBeVisible();
    await expect(
      page.locator('[data-slot="badge"]:visible').filter({ hasText: COPY.oneCard }),
      'the deck badge drops to one card',
    ).toHaveCount(1);

    // The deletion is real: the API no longer returns the card, and a repeat delete
    // finds nothing (404).
    const remaining = await listCards(page, deck.id);
    expect(
      remaining.map((card) => card.id),
      'the deck now holds only the kept card',
    ).toEqual([kept.id]);
    const repeat = await page.request.delete(`${FLASHCARDS_URL}/${doomed.id}`);
    expect(repeat.status(), 'the deleted card is gone server-side').toBe(404);

    // …and it survives a reload.
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/app/flashcards/${deck.id}$`));
    await expect(
      flashcardCard(page, doomed.id),
      'the card stays deleted after a reload',
    ).toHaveCount(0);
    await expect(flashcardCard(page, kept.id), 'the kept card survives a reload').toBeVisible();

    expect(pageErrors, 'the deck view raises no uncaught errors').toEqual([]);
  });
});
