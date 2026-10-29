import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

/**
 * STU-16 — Edycja talii (`/app/flashcards`).
 *
 * Case: from the deck menu open „Edytuj” (or „Edytuj Talię” from the deck view),
 * change the name and the description and save. Expected: the toast „Talia
 * zaktualizowana” and the new name/description on the list and in the deck view.
 *
 * Tenant (deterministic, `content` profile, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts STU-16 --fresh
 *
 * gives the org `qa-stu-16-<suffix>` with a manager, an educator and the student
 * this case signs in as — every id derived from `tenantKey('qa/cases/STU-16.md',
 * 'STU-16#<suffix>', 'qa-shared')` + `tenantId(key, entity)`. The legacy
 * prerequisite (`student1@dev.local`, own deck from STU-15) maps onto that student,
 * who creates the personal deck through the product API. Nothing global is read or
 * written: no admin setting, feature flag, plan, platform stat or singleton row, and
 * no other tenant.
 *
 * Both edit entry points were walked on the shared app (:3010, worker qa-env-1):
 * - Deck card menu („Więcej akcji: <nazwa>”) → „Edytuj” opens the dialog titled
 *   „Edytuj talię”, prefilled with the current name and description, submit button
 *   „Aktualizuj”. Saving shows the success toast, closes the dialog and refreshes
 *   the list from the API (the list is refetched before the toast fires).
 * - Deck view (`/app/flashcards/<id>`, reached through the card's „Zarządzaj”):
 *   the header shows the current name and description; the „Więcej akcji talii”
 *   menu → „Edytuj” opens the same form titled „Edytuj Talię”, and saving updates
 *   the header in place.
 * - A blank name is refused with the error toast „Nazwa talii jest wymagana”: the
 *   dialog stays open and the deck is not written.
 *
 * Acceptance points asserted here: the toast, the new name and description on the
 * list and in the deck view, and the same values in `GET /api/v1/flashcards/decks/:id`
 * (the update is persisted, not just an optimistic cache entry). The adjacent
 * regressions that matter for this surface are the prefill of the current values,
 * the list still being the API's data after a reload, and the name validation
 * (an edit must never save an empty name).
 */

const CASE = 'STU-16';

const DECKS_URL = '/api/v1/flashcards/decks';

/** Polish copy from `AppFlashcardDecksPage` / `AppFlashcardDeckViewPage` (pl.json). */
const COPY = {
  updated: 'Talia zaktualizowana',
  nameRequired: 'Nazwa talii jest wymagana',
  manage: 'Zarządzaj',
  listDialogTitle: 'Edytuj talię',
  viewDialogTitle: 'Edytuj Talię',
  update: 'Aktualizuj',
  cancel: 'Anuluj',
  edit: 'Edytuj',
  deckMenu: 'Więcej akcji talii',
  namePlaceholder: 'np. Przygotowanie do egzaminu, Rozdział 1...',
  descriptionPlaceholder: 'Krótki opis...',
} as const;

/** The prerequisite deck (STU-15) and the two edits of this case. */
const DECK = {
  created: { name: 'Biologia – rozdział 1', description: 'Komórka' },
  listEdit: { name: 'Biologia – rozdział 2', description: 'Organelle i błony' },
  viewEdit: { name: 'Biologia – rozdział 3', description: 'Komórka i organelle' },
} as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface DeckResponse {
  id: string;
  name: string;
  description: string | null;
  flashcard_count: number;
  visibility: 'personal' | 'group';
}

/** `GET` an endpoint as the signed-in student and unwrap the response envelope. */
async function getDeck(page: Page, deckId: string): Promise<DeckResponse> {
  const response = await page.request.get(`${DECKS_URL}/${deckId}`);
  expect(response.ok(), `GET ${DECKS_URL}/${deckId} → ${response.status()}`).toBe(true);
  const body = (await response.json()) as ApiEnvelope<DeckResponse>;
  expect(body.success, `GET ${DECKS_URL}/${deckId} success flag`).toBe(true);
  return body.data;
}

/** The deck card on the list: `DeckCard` renders the deck name as its heading. */
function deckCard(page: Page, name: string): Locator {
  return page.locator('main [data-slot="card"]').filter({
    has: page.getByRole('heading', { name, exact: true }),
  });
}

/** The card's own „…“ trigger; its accessible name comes from `A11y.more_actions_for`. */
function deckMenu(card: Locator, name: string): Locator {
  return card.getByRole('button', { name: `Więcej akcji: ${name}` });
}

/** The sonner toast carrying this text (success and validation share the region). */
function toast(page: Page, text: string): Locator {
  return page.locator('[data-sonner-toast]').filter({ hasText: text });
}

/** The open deck form dialog, scoped by its title. */
async function deckDialog(page: Page, title: string): Promise<Locator> {
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: title })).toBeVisible();
  return dialog;
}

test.describe('@case:STU-16 @area:STU @prio:P2 deck edit', () => {
  test('editing a deck updates its name and description on the list and in the deck view', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    const student = tenant.users.student;
    if (!student) throw new Error(`${CASE} needs the content tenant profile (student account)`);

    const pageErrors: string[] = [];
    const failedDeckWrites: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('response', (response) => {
      const path = new URL(response.url()).pathname;
      if (
        response.request().method() === 'PUT' &&
        path.startsWith(DECKS_URL) &&
        response.status() >= 400
      ) {
        failedDeckWrites.push(`${response.status()} ${path}`);
      }
    });

    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
    expect(new URL(page.url()).pathname, 'the student lands on /app').toBe('/app');
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

    // Prerequisite (STU-15): the student's own deck — created through the product
    // API so the spec never depends on a leftover row of another run.
    const createResponse = await page.request.post(DECKS_URL, { data: DECK.created });
    expect(
      createResponse.status(),
      `POST ${DECKS_URL} → ${createResponse.status()} ${await createResponse.text()}`,
    ).toBe(201);
    const created = (await createResponse.json()) as ApiEnvelope<DeckResponse>;
    expect(created.success, 'POST deck success flag').toBe(true);
    expect(created.data.id, 'deck id').toBeTruthy();
    expect(created.data.visibility, 'the deck stays personal („Tylko ja”)').toBe('personal');
    expect(created.data.flashcard_count, 'a new deck has no cards').toBe(0);

    await page.goto('/app/flashcards');
    await expect(page).toHaveURL(/\/app\/flashcards$/);

    const card = deckCard(page, DECK.created.name);
    await expect(card, 'the prerequisite deck is on the list').toBeVisible();
    await expect(card).toContainText(DECK.created.description);
    // `DeckCard` renders a mobile and a desktop row, so the badge is asserted on the
    // visible (desktop) one — same pattern as EDU-DECK-01.
    await expect(
      card.locator('[data-slot="badge"]:visible').filter({ hasText: '0 fiszek' }),
    ).toBeVisible();
    await expect(
      card.getByRole('button', { name: COPY.manage, exact: true }),
      'the owner sees „Zarządzaj”',
    ).toBeVisible();

    // --- Step 1 (deck menu): open „Edytuj” from the list --------------------
    await deckMenu(card, DECK.created.name).click();
    await page.getByRole('menuitem', { name: COPY.edit, exact: true }).click();

    const listDialog = await deckDialog(page, COPY.listDialogTitle);
    const listNameInput = listDialog.getByPlaceholder(COPY.namePlaceholder);
    const listDescriptionInput = listDialog.getByPlaceholder(COPY.descriptionPlaceholder);
    await expect(listNameInput, 'the form starts from the stored name').toHaveValue(
      DECK.created.name,
    );
    await expect(listDescriptionInput, 'the form starts from the stored description').toHaveValue(
      DECK.created.description,
    );

    await listNameInput.fill(DECK.listEdit.name);
    await listDescriptionInput.fill(DECK.listEdit.description);
    await listDialog.getByRole('button', { name: COPY.update, exact: true }).click();

    // --- Step 2 (save): toast and the list show the new values -------------
    await expect(toast(page, COPY.updated), 'the „Talia zaktualizowana” toast').toBeVisible();
    await expect(listDialog, 'the form closes after saving').toHaveCount(0);

    const renamedCard = deckCard(page, DECK.listEdit.name);
    await expect(renamedCard, 'the list shows the new name').toBeVisible();
    await expect(renamedCard).toContainText(DECK.listEdit.description);
    await expect(deckCard(page, DECK.created.name), 'the old name is gone').toHaveCount(0);

    // The update is persisted, not only applied to the cached list.
    const afterListEdit = await getDeck(page, created.data.id);
    expect(afterListEdit.name, 'stored name after the list edit').toBe(DECK.listEdit.name);
    expect(afterListEdit.description, 'stored description after the list edit').toBe(
      DECK.listEdit.description,
    );

    // A reload serves the list from the API again — the new values survive.
    await page.reload();
    await expect(page).toHaveURL(/\/app\/flashcards$/);
    await expect(deckCard(page, DECK.listEdit.name), 'the edit survives a reload').toBeVisible();
    await expect(deckCard(page, DECK.listEdit.name)).toContainText(DECK.listEdit.description);

    // --- Deck view: „Edytuj Talię” from the deck's own menu ----------------
    await deckCard(page, DECK.listEdit.name)
      .getByRole('button', { name: COPY.manage, exact: true })
      .click();
    await page.waitForURL(`**/app/flashcards/${created.data.id}`, { timeout: 15_000 });
    await expect(
      page.getByRole('heading', { level: 2, name: DECK.listEdit.name }),
      'the deck view header shows the current name',
    ).toBeVisible();
    await expect(page.getByText(DECK.listEdit.description, { exact: true })).toBeVisible();

    await page.getByRole('button', { name: COPY.deckMenu }).click();
    await page.getByRole('menuitem', { name: COPY.edit, exact: true }).click();

    const viewDialog = await deckDialog(page, COPY.viewDialogTitle);
    const viewNameInput = viewDialog.getByPlaceholder(COPY.namePlaceholder);
    const viewDescriptionInput = viewDialog.getByPlaceholder(COPY.descriptionPlaceholder);
    await expect(viewNameInput, 'the deck view form starts from the stored name').toHaveValue(
      DECK.listEdit.name,
    );
    await expect(
      viewDescriptionInput,
      'the deck view form starts from the stored description',
    ).toHaveValue(DECK.listEdit.description);

    await viewNameInput.fill(DECK.viewEdit.name);
    await viewDescriptionInput.fill(DECK.viewEdit.description);
    await viewDialog.getByRole('button', { name: COPY.update, exact: true }).click();

    await expect(
      toast(page, COPY.updated),
      'the second „Talia zaktualizowana” toast',
    ).toBeVisible();
    await expect(viewDialog, 'the deck view form closes after saving').toHaveCount(0);
    await expect(
      page.getByRole('heading', { level: 2, name: DECK.viewEdit.name }),
      'the deck view header updates in place',
    ).toBeVisible();
    await expect(page.getByText(DECK.viewEdit.description, { exact: true })).toBeVisible();

    const afterViewEdit = await getDeck(page, created.data.id);
    expect(afterViewEdit.name, 'stored name after the deck view edit').toBe(DECK.viewEdit.name);
    expect(afterViewEdit.description, 'stored description after the deck view edit').toBe(
      DECK.viewEdit.description,
    );

    // --- Adjacent regression: a blank name is refused, nothing is written --
    await page.getByRole('button', { name: COPY.deckMenu }).click();
    await page.getByRole('menuitem', { name: COPY.edit, exact: true }).click();

    const validationDialog = await deckDialog(page, COPY.viewDialogTitle);
    await validationDialog.getByPlaceholder(COPY.namePlaceholder).fill('   ');
    await validationDialog.getByRole('button', { name: COPY.update, exact: true }).click();

    await expect(toast(page, COPY.nameRequired), 'the blank-name error toast').toBeVisible();
    await expect(validationDialog, 'the form stays open for a correction').toBeVisible();
    const afterBlankName = await getDeck(page, created.data.id);
    expect(afterBlankName.name, 'the refused edit did not write a name').toBe(DECK.viewEdit.name);

    await validationDialog.getByRole('button', { name: COPY.cancel, exact: true }).click();
    await expect(validationDialog, '„Anuluj” closes the form').toHaveCount(0);
    await expect(
      page.getByRole('heading', { level: 2, name: DECK.viewEdit.name }),
      'the deck is unchanged after cancelling',
    ).toBeVisible();

    // The list reflects the deck view edit as well.
    await page.goto('/app/flashcards');
    await expect(page).toHaveURL(/\/app\/flashcards$/);
    const finalCard = deckCard(page, DECK.viewEdit.name);
    await expect(finalCard, 'the list shows the latest name').toBeVisible();
    await expect(finalCard).toContainText(DECK.viewEdit.description);
    await expect(
      finalCard.getByRole('button', { name: COPY.manage, exact: true }),
      'the deck is still owned by the student',
    ).toBeVisible();
    await expect(deckCard(page, DECK.listEdit.name), 'the intermediate name is gone').toHaveCount(
      0,
    );

    expect(failedDeckWrites, 'no deck update was rejected by the API').toEqual([]);
    expect(pageErrors, 'uncaught page errors during the edit flow').toEqual([]);
  });
});
