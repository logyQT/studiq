import { expect, test, type Locator, type Page } from '@playwright/test';
import { createQaSupabase } from '@qa/fixtures/qa-db';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * STU-26 — copying a flashcard to another deck (`/app/flashcards/<id>`).
 *
 * Case: in the flashcard's menu pick „Kopiuj do Innej Talii”, choose deck B and
 * press „Kopiuj do Talii”. Expected: the toast „Fiszka skopiowana pomyślnie” and
 * the „Fiszka Skopiowana” dialog with its two options; the copy is independent of
 * the original in both directions.
 *
 * Tenant (deterministic, `content` profile, a fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts STU-26 --fresh
 *
 * gives the org `qa-stu-26-<suffix>` with a manager, an educator and the student
 * this case signs in as — every id derived from `tenantKey('qa/cases/STU-26.md',
 * 'STU-26#<suffix>', 'qa-shared')` + `tenantId(key, entity)`. The legacy
 * prerequisite („Talie A i B” on `student1@dev.local`) maps onto that student, who
 * creates both decks and the source card through the product API inside its active
 * org. Nothing global is read or written: no admin setting, feature flag, plan,
 * platform stat or singleton row, and no other tenant.
 *
 * Walk on the shared app (2026-10-29, Polish UI):
 * 1. The card's kebab is „Więcej akcji fiszki”; its entry „Kopiuj do Innej Talii”
 *    opens the dialog „Kopiuj Fiszkę do Innej Talii” („Nowa fiszka o tej samej
 *    zawartości zostanie utworzona w wybranej talii. Będą niezależne.”) listing
 *    the other decks of the org; „Kopiuj do Talii” stays disabled until a deck is
 *    picked.
 * 2. Confirming POSTs `/api/v1/flashcards/<id>/copy`, shows the toast „Fiszka
 *    skopiowana pomyślnie” and the „Fiszka Skopiowana” dialog with „Przejdź do
 *    Nowej Fiszki” (primary) and „Zostań Tutaj” (outline).
 * 3. „Przejdź do Nowej Fiszki” navigates to the *target deck* (``/app/flashcards/
 *    <deckB>``), where the copy sits with the same face/back — the product has no
 *    per-card route, so the deck that now holds the copy is the deepest link
 *    available. „Zostań Tutaj” just closes the dialog and keeps the source deck.
 * 4. Both cards are ordinary, independent rows: editing the copy leaves the
 *    original untouched and editing the original leaves the copy untouched.
 *
 * Acceptance points asserted: the toast, the „Fiszka Skopiowana” dialog with both
 * options, the copy existing in deck B with the original's content and a different
 * id, and independence in both directions (edited copy → original unchanged,
 * edited original → copy unchanged). Adjacent regressions on the same surface: the
 * target deck list excludes the source deck, the confirm button is disabled until
 * a deck is selected, „Zostań Tutaj” does not navigate, and a second copy lands in
 * the target deck again.
 */

const CASE = 'STU-26';

const FLASHCARDS_URL = '/api/v1/flashcards';
const DECKS_URL = '/api/v1/flashcards/decks';

/** Polish copy from `Flashcards.kt.*` / `A11y` (pl.json) and the walk. */
const COPY = {
  menuMoreActions: 'Więcej akcji fiszki',
  menuCopy: 'Kopiuj do Innej Talii',
  menuEdit: 'Edytuj',
  copyDialogTitle: 'Kopiuj Fiszkę do Innej Talii',
  copyDialogDescription:
    'Nowa fiszka o tej samej zawartości zostanie utworzona w wybranej talii. Będą niezależne.',
  copyConfirm: 'Kopiuj do Talii',
  successTitle: 'Fiszka Skopiowana',
  goToCard: 'Przejdź do Nowej Fiszki',
  stayHere: 'Zostań Tutaj',
  copiedToast: 'Fiszka skopiowana pomyślnie',
  editDialogTitle: 'Edytuj Fiszkę',
  frontPlaceholder: 'Wprowadź pytanie lub prompt...',
  backPlaceholder: 'Wprowadź odpowiedź lub wyjaśnienie...',
  update: 'Aktualizuj',
} as const;

/** The prerequisite card and the two independent edits of step 4. */
const CARD = {
  original: { front: 'Pytanie oryginału', back: 'Odpowiedź oryginału' },
  copyEdit: { front: 'Pytanie kopii', back: 'Odpowiedź kopii' },
  originalEdit: { front: 'Pytanie oryginału po edycji', back: 'Odpowiedź oryginału po edycji' },
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

/** The cards the API serves for one deck (the deck view's own query). */
async function listCards(page: Page, deckId: string): Promise<FlashcardResponse[]> {
  const response = await page.request.get(`${FLASHCARDS_URL}?deckIds=${deckId}&limit=30`);
  expect(response.ok(), `GET ${FLASHCARDS_URL}?deckIds=${deckId} → ${response.status()}`).toBe(
    true,
  );
  const body = (await response.json()) as ApiEnvelope<{ items: FlashcardResponse[] }>;
  expect(body.success, `GET ${FLASHCARDS_URL}?deckIds=${deckId} success flag`).toBe(true);
  return body.data.items;
}

/** The deck view's flashcard card, addressed by the front it renders. */
function flashcardCard(page: Page, front: string): Locator {
  return page
    .locator('[data-slot="card"][id^="fc-"]')
    .filter({ has: page.getByText(front, { exact: true }) });
}

/** The sonner toast carrying this text (success and error share the region). */
function toast(page: Page, text: string): Locator {
  return page.locator('[data-sonner-toast]').filter({ hasText: text });
}

/** Open the card's kebab and press „Kopiuj do Innej Talii”, returning the dialog. */
async function openCopyDialog(page: Page, front: string): Promise<Locator> {
  const card = flashcardCard(page, front);
  await expect(card, `the card „${front}” is in the deck`).toHaveCount(1);
  // Each card renders a mobile and a desktop kebab; only the desktop one is visible.
  await card.getByRole('button', { name: COPY.menuMoreActions }).filter({ visible: true }).click();
  await page.getByRole('menuitem', { name: COPY.menuCopy, exact: true }).click();

  const dialog = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: COPY.copyDialogTitle }) });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Open the „Edytuj” form of a card and rewrite both sides. */
async function editCard(
  page: Page,
  front: string,
  next: { front: string; back: string },
): Promise<void> {
  const card = flashcardCard(page, front);
  await expect(card, `the card „${front}” is in the deck`).toHaveCount(1);
  await card.getByRole('button', { name: COPY.menuMoreActions }).filter({ visible: true }).click();
  await page.getByRole('menuitem', { name: COPY.menuEdit, exact: true }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: COPY.editDialogTitle })).toBeVisible();
  await dialog.getByPlaceholder(COPY.frontPlaceholder).fill(next.front);
  await dialog.getByPlaceholder(COPY.backPlaceholder).fill(next.back);
  await dialog.getByRole('button', { name: COPY.update, exact: true }).click();
  await expect(dialog, 'the edit form closes after saving').toHaveCount(0);
  await expect(flashcardCard(page, next.front), 'the edited card is rendered').toHaveCount(1);
}

/**
 * Retry-safety: CI seeds a case tenant **once** and reuses it for every retry, so
 * an attempt that dies halfway through the copy flow leaves its decks behind. A
 * retry would then offer the previous attempt's deck B in the copy dialog and the
 * card count assertions would see its cards. Reset just this tenant's student
 * decks (deleting a deck cascades its flashcards) so every attempt starts from the
 * same first-run state.
 */
async function resetStudentDeckState(tenant: QaTenant): Promise<void> {
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
}

test.describe('@case:STU-26 @area:STU @prio:P2 flashcard copy', () => {
  test('copying a flashcard to another deck creates an independent copy', async ({ page }) => {
    test.setTimeout(180_000);

    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    expect(tenant.users.student, `${CASE} needs the content tenant profile (student)`).toBeTruthy();

    const failedCopyRequests: string[] = [];
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('response', (response) => {
      const path = new URL(response.url()).pathname;
      if (
        response.request().method() === 'POST' &&
        path.startsWith(`${FLASHCARDS_URL}/`) &&
        path.endsWith('/copy') &&
        response.status() >= 400
      ) {
        failedCopyRequests.push(`${response.status()} ${path}`);
      }
    });

    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

    // A retry reuses this tenant, so drop whatever the previous attempt left.
    await resetStudentDeckState(tenant);

    // ── Prerequisite: deck A with one card, deck B as the copy target ────────
    const suffix = tenant.runSuffix ?? '';
    const deckAName = `STU-26 Talia A ${suffix}`.trim();
    const deckBName = `STU-26 Talia B ${suffix}`.trim();

    const deckA = await createDeck(page, deckAName, tenant.org!.id);
    const deckB = await createDeck(page, deckBName, tenant.org!.id);

    const cardResponse = await page.request.post(FLASHCARDS_URL, {
      data: { deckId: deckA.id, ...CARD.original },
    });
    expect(
      cardResponse.status(),
      `POST ${FLASHCARDS_URL} → ${cardResponse.status()} ${await cardResponse.text()}`,
    ).toBe(201);
    const original = ((await cardResponse.json()) as ApiEnvelope<FlashcardResponse>).data;
    expect(original.deck_id, 'the source card lives in deck A').toBe(deckA.id);

    const deckAUrl = `/app/flashcards/${deckA.id}`;
    const deckBUrl = `/app/flashcards/${deckB.id}`;

    const deckAResponse = await page.goto(deckAUrl);
    expect(deckAResponse?.status(), `GET ${deckAUrl}`).toBe(200);
    await expect(
      page.getByRole('heading', { level: 2, name: deckAName }),
      'the source deck view',
    ).toBeVisible();
    await expect(flashcardCard(page, CARD.original.front)).toHaveCount(1);

    // ── Step 1: „Kopiuj do Innej Talii” lists the other decks ───────────────
    const copyDialog = await openCopyDialog(page, CARD.original.front);
    await expect(
      copyDialog.getByText(COPY.copyDialogDescription, { exact: true }),
      'the copy dialog explains the copy is independent',
    ).toBeVisible();

    const confirmCopy = copyDialog.getByRole('button', { name: COPY.copyConfirm, exact: true });
    await expect(confirmCopy, 'confirming needs a target deck').toBeDisabled();
    await expect(
      copyDialog.getByRole('button').filter({ hasText: deckBName }),
      'deck B is offered as a target',
    ).toBeVisible();
    await expect(
      copyDialog.getByRole('button').filter({ hasText: deckAName }),
      'the source deck is not offered as a target',
    ).toHaveCount(0);

    // ── Step 2: pick deck B and copy ────────────────────────────────────────
    await copyDialog.getByRole('button').filter({ hasText: deckBName }).click();
    await expect(confirmCopy, 'confirming is possible once deck B is picked').toBeEnabled();
    await confirmCopy.click();

    await expect(
      toast(page, COPY.copiedToast),
      'the „Fiszka skopiowana pomyślnie” toast',
    ).toBeVisible();
    await expect(copyDialog, 'the copy form closes after copying').toHaveCount(0);

    const successDialog = page
      .getByRole('dialog')
      .filter({ has: page.getByRole('heading', { name: COPY.successTitle }) });
    await expect(successDialog, 'the „Fiszka Skopiowana” dialog').toBeVisible();
    await expect(
      successDialog.getByRole('button', { name: COPY.goToCard, exact: true }),
      'the „Przejdź do Nowej Fiszki” option',
    ).toBeVisible();
    await expect(
      successDialog.getByRole('button', { name: COPY.stayHere, exact: true }),
      'the „Zostań Tutaj” option',
    ).toBeVisible();

    // The copy is persisted in deck B with the original's content, as a new card.
    const firstCopyCards = await listCards(page, deckB.id);
    expect(firstCopyCards, 'deck B holds exactly the one copy').toHaveLength(1);
    const firstCopy = firstCopyCards[0];
    expect(firstCopy.id, 'the copy is a separate card').not.toBe(original.id);
    expect(firstCopy.deck_id, 'the copy lives in deck B').toBe(deckB.id);
    expect(firstCopy.front, 'the copy keeps the original front').toBe(CARD.original.front);
    expect(firstCopy.back, 'the copy keeps the original back').toBe(CARD.original.back);

    // ── Step 3 (first attempt): „Przejdź do Nowej Fiszki” ──────────────────
    await successDialog.getByRole('button', { name: COPY.goToCard, exact: true }).click();
    await expect(page, 'the primary option opens the target deck').toHaveURL(
      new RegExp(`${deckBUrl}$`),
    );
    await expect(
      page.getByRole('heading', { level: 2, name: deckBName }),
      'the target deck view',
    ).toBeVisible();
    await expect(
      flashcardCard(page, CARD.original.front),
      'the copy is listed in deck B',
    ).toHaveCount(1);

    // ── Step 4 (copy → original): editing the copy leaves the original ─────
    await editCard(page, CARD.original.front, CARD.copyEdit);
    await expect(
      flashcardCard(page, CARD.original.front),
      'the copy no longer shows the copied front',
    ).toHaveCount(0);

    const storedCopy = await getCard(page, firstCopy.id);
    expect(storedCopy.front, 'the stored copy carries the edit').toBe(CARD.copyEdit.front);
    expect(storedCopy.back, 'the stored copy carries the edit').toBe(CARD.copyEdit.back);
    const untouchedOriginal = await getCard(page, original.id);
    expect(untouchedOriginal.front, 'editing the copy leaves the original front').toBe(
      CARD.original.front,
    );
    expect(untouchedOriginal.back, 'editing the copy leaves the original back').toBe(
      CARD.original.back,
    );

    // ── Step 4 (original → copy): editing the original leaves the copy ─────
    await page.goto(deckAUrl);
    await expect(
      page.getByRole('heading', { level: 2, name: deckAName }),
      'back on the source deck',
    ).toBeVisible();
    await expect(
      flashcardCard(page, CARD.original.front),
      'the original is unchanged by the copy edit',
    ).toHaveCount(1);

    await editCard(page, CARD.original.front, CARD.originalEdit);
    const editedOriginal = await getCard(page, original.id);
    expect(editedOriginal.front, 'the stored original carries its own edit').toBe(
      CARD.originalEdit.front,
    );
    const stillIndependent = await getCard(page, firstCopy.id);
    expect(stillIndependent.front, 'editing the original leaves the copy front').toBe(
      CARD.copyEdit.front,
    );
    expect(stillIndependent.back, 'editing the original leaves the copy back').toBe(
      CARD.copyEdit.back,
    );

    // ── Step 3 (second attempt): „Zostań Tutaj” keeps the source deck ──────
    const secondCopyDialog = await openCopyDialog(page, CARD.originalEdit.front);
    await secondCopyDialog.getByRole('button').filter({ hasText: deckBName }).click();
    await secondCopyDialog.getByRole('button', { name: COPY.copyConfirm, exact: true }).click();

    await expect(
      page.getByRole('dialog').getByRole('heading', { name: COPY.successTitle }),
      'the success dialog is shown again',
    ).toBeVisible();
    await page.getByRole('button', { name: COPY.stayHere, exact: true }).click();

    await expect(page.getByRole('dialog'), '„Zostań Tutaj” closes the dialog').toHaveCount(0);
    await expect(page, '„Zostań Tutaj” stays on the source deck').toHaveURL(
      new RegExp(`${deckAUrl}$`),
    );

    const secondRound = await listCards(page, deckB.id);
    expect(secondRound, 'deck B holds the copy and the second copy').toHaveLength(2);
    const secondCopy = secondRound.find((card) => card.id !== firstCopy.id);
    expect(secondCopy, 'the second copy is a new card').toBeTruthy();
    expect(secondCopy!.front, 'the second copy uses the original’s current front').toBe(
      CARD.originalEdit.front,
    );
    expect(secondCopy!.back, 'the second copy uses the original’s current back').toBe(
      CARD.originalEdit.back,
    );

    // The source deck is untouched by either copy.
    const sourceCards = await listCards(page, deckA.id);
    expect(sourceCards, 'deck A still holds only its own card').toHaveLength(1);
    expect(sourceCards[0].id, 'deck A still holds the original').toBe(original.id);
    expect(sourceCards[0].front, 'the original keeps its own content').toBe(
      CARD.originalEdit.front,
    );

    expect(failedCopyRequests, 'no copy request was rejected by the API').toEqual([]);
    expect(pageErrors, 'uncaught page errors during the copy flow').toEqual([]);
  });
});

/** Create a deck in the signed-in student's active org and return it. */
async function createDeck(page: Page, name: string, organizationId: string): Promise<DeckResponse> {
  const response = await page.request.post(DECKS_URL, { data: { name } });
  expect(
    response.status(),
    `POST ${DECKS_URL} → ${response.status()} ${await response.text()}`,
  ).toBe(201);
  const deck = ((await response.json()) as ApiEnvelope<DeckResponse>).data;
  expect(deck.organization_id, `deck „${name}” belongs to the tenant organization`).toBe(
    organizationId,
  );
  return deck;
}
