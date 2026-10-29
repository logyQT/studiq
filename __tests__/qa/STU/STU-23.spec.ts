import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

/**
 * STU-23 — editing a flashcard from the deck view (`/app/flashcards/<id>`).
 *
 * Case: in the flashcard's menu pick „Edytuj”, change the content and save with
 * „Aktualizuj”. Expected: the toast „Fiszka zaktualizowana pomyślnie” and the
 * changes visible immediately.
 *
 * Tenant (deterministic, `content` profile, a fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts STU-23 --fresh
 *
 * gives the org `qa-stu-23-<suffix>` with a manager, an educator and the student
 * this case signs in as — every id derived from `tenantKey('qa/cases/STU-23.md',
 * 'STU-23#<suffix>', 'qa-shared')` + `tenantId(key, entity)`. The legacy
 * prerequisite (student1@dev.local, personal deck `O1S1`) maps onto that student,
 * who creates one deck and one card through the product API inside its active org.
 * Nothing global is read or written: no admin setting, feature flag, plan,
 * platform stat or singleton row, and no other tenant.
 *
 * Walk on the shared app (2026-10-29, Polish UI):
 * 1. The flashcard card's kebab is „Więcej akcji fiszki”; its owned entry
 *    „Edytuj” opens the dialog „Edytuj Fiszkę” — the same `CreateCardDialog`
 *    in edit mode — with both textareas prefilled from the stored card and the
 *    buttons „Anuluj” / „Aktualizuj”.
 * 2. „Aktualizuj” PUTs `/api/v1/flashcards/<id>`, shows the toast „Fiszka
 *    zaktualizowana pomyślnie”, closes the dialog and the card re-renders in place
 *    from the invalidated list (no reload needed).
 * 3. „Anuluj” closes the dialog without a toast and without writing.
 * 4. An empty side is refused with „Zarówno przód jak i tył są wymagane”; the
 *    dialog stays open and nothing is written.
 *
 * Acceptance points asserted: the toast, the edited front and back on the card
 * immediately after saving, and the same values in `GET /api/v1/flashcards/:id`
 * after a reload (the update is persisted, not just an optimistic cache entry).
 * Adjacent regressions on the same surface: the form starts from the stored
 * content, „Anuluj” writes nothing, and the required-content validation refuses
 * an empty side.
 */

const CASE = 'STU-23';

const FLASHCARDS_URL = '/api/v1/flashcards';
const DECKS_URL = '/api/v1/flashcards/decks';

/** Polish copy from `AppFlashcardDeckViewPage` / `A11y` (pl.json) and the walk. */
const COPY = {
  menuMoreActions: 'Więcej akcji fiszki',
  menuEdit: 'Edytuj',
  dialogTitle: 'Edytuj Fiszkę',
  frontPlaceholder: 'Wprowadź pytanie lub prompt...',
  backPlaceholder: 'Wprowadź odpowiedź lub wyjaśnienie...',
  update: 'Aktualizuj',
  cancel: 'Anuluj',
  updatedToast: 'Fiszka zaktualizowana pomyślnie',
  requiredToast: 'Zarówno przód jak i tył są wymagane',
} as const;

/** The prerequisite card and the edit of this case. */
const CARD = {
  original: { front: 'Pytanie początkowe', back: 'Odpowiedź początkowa' },
  edited: { front: 'Pytanie po edycji', back: 'Odpowiedź po edycji' },
  cancelled: 'Pytanie anulowane',
} as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface DeckResponse {
  id: string;
  name: string;
  organization_id: string | null;
}

interface FlashcardResponse {
  id: string;
  deck_id: string;
  front: string;
  back: string;
}

/** `GET` a card as the signed-in student and unwrap the response envelope. */
async function getCard(page: Page, cardId: string): Promise<FlashcardResponse> {
  const response = await page.request.get(`${FLASHCARDS_URL}/${cardId}`);
  expect(response.ok(), `GET ${FLASHCARDS_URL}/${cardId} → ${response.status()}`).toBe(true);
  const body = (await response.json()) as ApiEnvelope<FlashcardResponse>;
  expect(body.success, `GET ${FLASHCARDS_URL}/${cardId} success flag`).toBe(true);
  return body.data;
}

/** The deck view's flashcard card, addressed by the front it renders. */
function flashcardCard(page: Page, front: string): Locator {
  return page
    .locator('[data-slot="card"][id^="fc-"]')
    .filter({ has: page.getByText(front, { exact: true }) });
}

/** The card's own kebab; the card renders a mobile and a desktop trigger. */
function cardMenu(card: Locator): Locator {
  return card.getByRole('button', { name: COPY.menuMoreActions }).filter({ visible: true });
}

/** The sonner toast carrying this text (success and validation share the region). */
function toast(page: Page, text: string): Locator {
  return page.locator('[data-sonner-toast]').filter({ hasText: text });
}

/** Open „Edytuj” from a card's menu and return the open form dialog. */
async function openEditDialog(page: Page, front: string): Promise<Locator> {
  const card = flashcardCard(page, front);
  await expect(card, `the card „${front}” is in the deck`).toHaveCount(1);
  await cardMenu(card).click();
  await page.getByRole('menuitem', { name: COPY.menuEdit, exact: true }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: COPY.dialogTitle })).toBeVisible();
  return dialog;
}

test.describe('@case:STU-23 @area:STU @prio:P2 flashcard edit', () => {
  test('editing a flashcard persists the new content and shows it immediately', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    expect(tenant.users.student, `${CASE} needs the content tenant profile (student)`).toBeTruthy();

    const pageErrors: string[] = [];
    const failedCardWrites: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('response', (response) => {
      const path = new URL(response.url()).pathname;
      if (
        response.request().method() === 'PUT' &&
        path.startsWith(`${FLASHCARDS_URL}/`) &&
        response.status() >= 400
      ) {
        failedCardWrites.push(`${response.status()} ${path}`);
      }
    });

    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

    // ── Prerequisite: a deck with one flashcard ─────────────────────────────
    const deckName = `STU-23 talia ${tenant.runSuffix ?? ''}`.trim();
    const deckResponse = await page.request.post(DECKS_URL, { data: { name: deckName } });
    expect(
      deckResponse.status(),
      `POST ${DECKS_URL} → ${deckResponse.status()} ${await deckResponse.text()}`,
    ).toBe(201);
    const deck = ((await deckResponse.json()) as ApiEnvelope<DeckResponse>).data;
    expect(deck.organization_id, 'the deck belongs to the tenant organization').toBe(
      tenant.org!.id,
    );

    const cardResponse = await page.request.post(FLASHCARDS_URL, {
      data: { deckId: deck.id, ...CARD.original },
    });
    expect(
      cardResponse.status(),
      `POST ${FLASHCARDS_URL} → ${cardResponse.status()} ${await cardResponse.text()}`,
    ).toBe(201);
    const card = ((await cardResponse.json()) as ApiEnvelope<FlashcardResponse>).data;
    expect(card.front).toBe(CARD.original.front);
    expect(card.back).toBe(CARD.original.back);

    const deckUrl = `/app/flashcards/${deck.id}`;
    const response = await page.goto(deckUrl);
    expect(response?.status(), `GET ${deckUrl}`).toBe(200);
    await expect(
      page.getByRole('heading', { level: 2, name: deckName }),
      'the deck view of the tenant deck',
    ).toBeVisible();

    const originalCard = flashcardCard(page, CARD.original.front);
    await expect(originalCard).toHaveCount(1);
    await expect(
      originalCard.getByText(CARD.original.back, { exact: true }).filter({ visible: true }),
      'the card shows its stored answer',
    ).toBeVisible();

    // ── Step 1: „Edytuj” opens the form prefilled from the stored card ──────
    const editDialog = await openEditDialog(page, CARD.original.front);
    const frontInput = editDialog.getByPlaceholder(COPY.frontPlaceholder);
    const backInput = editDialog.getByPlaceholder(COPY.backPlaceholder);
    await expect(frontInput, 'the form starts from the stored front').toHaveValue(
      CARD.original.front,
    );
    await expect(backInput, 'the form starts from the stored back').toHaveValue(CARD.original.back);

    // ── Step 1 (save): change both sides and press „Aktualizuj” ─────────────
    await frontInput.fill(CARD.edited.front);
    await backInput.fill(CARD.edited.back);
    await editDialog.getByRole('button', { name: COPY.update, exact: true }).click();

    // ── Expected result: toast and the change visible at once ──────────────
    await expect(
      toast(page, COPY.updatedToast),
      'the „Fiszka zaktualizowana pomyślnie” toast',
    ).toBeVisible();
    await expect(editDialog, 'the form closes after saving').toHaveCount(0);

    const editedCard = flashcardCard(page, CARD.edited.front);
    await expect(editedCard, 'the card re-renders with the new front immediately').toHaveCount(1);
    await expect(
      editedCard.getByText(CARD.edited.back, { exact: true }).filter({ visible: true }),
      'the card shows the new answer immediately',
    ).toBeVisible();
    await expect(flashcardCard(page, CARD.original.front), 'the old front is gone').toHaveCount(0);

    // The update is persisted, not only applied to the cached list.
    const stored = await getCard(page, card.id);
    expect(stored.front, 'stored front after the edit').toBe(CARD.edited.front);
    expect(stored.back, 'stored back after the edit').toBe(CARD.edited.back);

    // A reload serves the deck from the API again — the edit survives it.
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`${deckUrl}$`));
    const reloadedCard = flashcardCard(page, CARD.edited.front);
    await expect(reloadedCard, 'the edit survives a reload').toHaveCount(1);
    await expect(
      reloadedCard.getByText(CARD.edited.back, { exact: true }).filter({ visible: true }),
    ).toBeVisible();
    await expect(flashcardCard(page, CARD.original.front)).toHaveCount(0);

    // ── Adjacent regression: „Anuluj” writes nothing ───────────────────────
    const cancelDialog = await openEditDialog(page, CARD.edited.front);
    await cancelDialog.getByPlaceholder(COPY.frontPlaceholder).fill(CARD.cancelled);
    await cancelDialog.getByRole('button', { name: COPY.cancel, exact: true }).click();

    await expect(cancelDialog, '„Anuluj” closes the form').toHaveCount(0);
    await expect(page.locator('[data-sonner-toast]'), 'no toast on cancel').toHaveCount(0);
    await expect(flashcardCard(page, CARD.edited.front), 'the card is unchanged').toHaveCount(1);
    await expect(
      flashcardCard(page, CARD.cancelled),
      'the cancelled front is not rendered',
    ).toHaveCount(0);
    const afterCancel = await getCard(page, card.id);
    expect(afterCancel.front, 'the cancelled edit did not write a front').toBe(CARD.edited.front);

    // ── Adjacent regression: an empty side is refused ──────────────────────
    const validationDialog = await openEditDialog(page, CARD.edited.front);
    await validationDialog.getByPlaceholder(COPY.frontPlaceholder).fill('');
    await validationDialog.getByRole('button', { name: COPY.update, exact: true }).click();

    await expect(toast(page, COPY.requiredToast), 'the required-content error toast').toBeVisible();
    await expect(validationDialog, 'the form stays open for a correction').toBeVisible();
    const afterEmptyFront = await getCard(page, card.id);
    expect(afterEmptyFront.front, 'the refused edit did not clear the front').toBe(
      CARD.edited.front,
    );

    await validationDialog.getByRole('button', { name: COPY.cancel, exact: true }).click();
    await expect(validationDialog, 'the form closes after cancelling').toHaveCount(0);
    await expect(flashcardCard(page, CARD.edited.front)).toHaveCount(1);

    expect(failedCardWrites, 'no flashcard update was rejected by the API').toEqual([]);
    expect(pageErrors, 'uncaught page errors during the edit flow').toEqual([]);
  });
});
