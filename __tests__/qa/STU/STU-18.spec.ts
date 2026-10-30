import { expect, test, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * STU-18 — deleting a deck from the student deck list (`/app/flashcards`).
 *
 * Case prerequisite (reconciled with the tenant seeder): the student's own
 * temporary deck. The legacy account (`student1@dev.local`, deck `O1S1`) is never
 * used; the spec owns the whole graph.
 *
 *   bun scripts/qa-tenant.ts STU-18 --fresh
 *
 * Tenant: the case's own `content` tenant — organization
 * `qa-stu-18-<suffix>`, a manager, an educator and the student under test, all
 * ids derived from `tenantKey('qa/cases/STU-18.md', 'STU-18#<suffix>', 'qa-shared')`
 * plus `tenantId(key, entity)`. The student creates one deck through the product
 * API inside its active organization, so the list endpoint returns it; nothing
 * global (admin setting, feature flag, plan, stat, singleton row) is read or
 * written, and no other tenant is touched.
 *
 * Acceptance points (walked on the shared app, Polish UI):
 * 1. The deck menu offers „Usuń”; it opens the confirmation dialog titled
 *    „Usunąć talię?” with the description „To trwale usunie talię. Tej akcji nie
 *    można cofnąć.” and the buttons „Anuluj” / „Usuń”.
 * 2. „Anuluj” closes the dialog, shows no toast and deletes nothing: the deck is
 *    still listed („1 talia”) and `GET /api/v1/flashcards/decks/:id` still
 *    returns it.
 * 3. Confirming with „Usuń” shows the toast „Talia usunięta”, drops the deck from
 *    the list („0 talii”, empty state) and the deck API answers 404 afterwards.
 */

const CASE = 'STU-18';

/** Polish copy from `AppFlashcardDecksPage` and the case text. */
const COPY = {
  menuMoreActions: (name: string) => `Więcej akcji: ${name}`,
  deleteItem: 'Usuń',
  dialogTitle: 'Usunąć talię?',
  dialogDescription: 'To trwale usunie talię. Tej akcji nie można cofnąć.',
  cancel: 'Anuluj',
  confirm: 'Usuń',
  deletedToast: 'Talia usunięta',
  oneDeck: '1 talia',
  noDecks: '0 talii',
  emptyState: 'Nic tutaj jeszcze nie ma, stwórz swoją pierwszą talię!',
} as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface CreatedDeck {
  id: string;
  name: string;
  visibility?: string;
  organization_id: string | null;
}

/** A visible deck card in the grid, addressed by its own heading. */
function deckCard(page: Page, name: string) {
  return page
    .locator('main .group:visible')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });
}

/** The deck counter above the grid („N talii”). */
function deckCount(page: Page, text: string) {
  return page.locator('main p').filter({ hasText: new RegExp(`^${text}$`) });
}

/**
 * Open the card's kebab menu. The card renders a mobile and a desktop menu
 * trigger; only one of them is in the accessibility tree at a time.
 */
async function openDeckMenu(page: Page, name: string): Promise<void> {
  const card = deckCard(page, name);
  await expect(card).toHaveCount(1);
  await card.getByRole('button', { name: COPY.menuMoreActions(name) }).click();
  await expect(page.getByRole('menuitem', { name: COPY.deleteItem })).toBeVisible();
}

/** Open the delete confirmation from the deck menu. */
async function openDeleteDialog(page: Page, name: string): Promise<void> {
  await openDeckMenu(page, name);
  await page.getByRole('menuitem', { name: COPY.deleteItem }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

test.describe('STU-18 @area:STU @prio:P2 delete deck', () => {
  test('cancel keeps the deck and confirming deletes it with a toast', async ({ page }) => {
    test.setTimeout(120_000);

    const tenant: QaTenant = loadTenant(CASE);
    const deckName = `STU-18 talia ${tenant.runSuffix ?? ''}`.trim();

    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app/ });

    // ── Prerequisite: the student's own temporary deck ──────────────────────
    const created = await page.request.post('/api/v1/flashcards/decks', {
      data: { name: deckName },
    });
    expect(created.status(), `POST /api/v1/flashcards/decks (${deckName})`).toBe(201);
    const deck = ((await created.json()) as ApiEnvelope<CreatedDeck>).data;
    expect(deck.name).toBe(deckName);
    // The deck lands in the student's active organization, which is the scope the
    // list endpoint reads; a deck outside it would never be rendered here.
    expect(deck.organization_id, 'deck belongs to the active tenant organization').toBe(
      tenant.org!.id,
    );

    const response = await page.goto('/app/flashcards');
    expect(response?.status(), 'GET /app/flashcards').toBe(200);
    await expect(page).toHaveURL(/\/app\/flashcards$/);
    await expect(deckCount(page, COPY.oneDeck)).toBeVisible();
    await expect(deckCard(page, deckName)).toHaveCount(1);

    // ── Step 1: „Usuń” opens the confirmation dialog with the stated copy ────
    await openDeleteDialog(page, deckName);

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: COPY.dialogTitle })).toBeVisible();
    await expect(dialog.getByText(COPY.dialogDescription, { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: COPY.cancel })).toBeVisible();
    await expect(dialog.getByRole('button', { name: COPY.confirm })).toBeVisible();

    // ── Step 2: „Anuluj” deletes nothing ────────────────────────────────────
    await dialog.getByRole('button', { name: COPY.cancel }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('[data-sonner-toast]'), 'no toast on cancel').toHaveCount(0);

    await expect(deckCount(page, COPY.oneDeck)).toBeVisible();
    await expect(deckCard(page, deckName), 'the deck survives „Anuluj”').toHaveCount(1);

    const stillThere = await page.request.get(`/api/v1/flashcards/decks/${deck.id}`);
    expect(stillThere.status(), 'GET the deck after „Anuluj”').toBe(200);

    // ── Step 3: confirm and the deck disappears ─────────────────────────────
    await openDeleteDialog(page, deckName);
    await page.getByRole('dialog').getByRole('button', { name: COPY.confirm }).click();

    await expect(
      page.locator('[data-sonner-toast]').filter({ hasText: COPY.deletedToast }),
      '„Talia usunięta” toast',
    ).toBeVisible();
    await expect(page.getByRole('dialog')).toBeHidden();

    await expect(deckCard(page, deckName), 'the deleted deck is gone from the grid').toHaveCount(0);
    await expect(deckCount(page, COPY.noDecks)).toBeVisible();
    await expect(page.getByText(COPY.emptyState, { exact: true })).toBeVisible();

    const gone = await page.request.get(`/api/v1/flashcards/decks/${deck.id}`);
    expect(gone.status(), 'GET the deleted deck').toBe(404);

    const list = await page.request.get('/api/v1/flashcards/decks');
    expect(list.status(), 'GET /api/v1/flashcards/decks').toBe(200);
    expect(
      ((await list.json()) as ApiEnvelope<{ items: { id: string }[] }>).data.items,
      'the list endpoint no longer returns the deck',
    ).toHaveLength(0);
  });
});
