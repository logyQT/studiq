import { expect, test, type Page } from '@playwright/test';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

/**
 * STU-19 — Import talii/fiszek z CSV (student, `/app/flashcards`).
 *
 * Case: from the deck list open the CSV import, drop a correct CSV, map the
 * „Przód” / „Tył” / „Temat” columns, then import — the preview reports how many
 * rows were found, the import reports how many were created, and the new deck
 * holds every card with the right front, back and topic.
 *
 * Tenant (deterministic, `content` profile, a fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts STU-19 --fresh
 *
 * gives the org `qa-stu-19-<suffix>` with a manager, an educator and the student
 * under test, plus the default group `G1` — all ids derived from
 * `tenantKey('qa/cases/STU-19.md', 'STU-19#<suffix>', 'qa-shared')` +
 * `tenantId(key, entity)`. The case's prerequisite file `fiszki_poprawne.csv`
 * (folder `Studiq_dane_testowe`) is not in the repo, so the spec builds an
 * equivalent one in memory (12 well-formed rows: `front`, `back`, `topic`) and
 * uploads it through the dialog's own file input — nothing is read from disk.
 * The student owns no deck before the run, so the list is deterministic. No
 * global setting, feature flag, plan, platform stat or singleton row is read or
 * written, and no other tenant is touched.
 *
 * Reconciliation notes (walk on the shared app, 2026-10-29, Polish UI):
 * 1. The toolbar action is labelled „Importuj” (not „Importuj CSV”); the dialog
 *    it opens is titled „Importuj CSV”. The spec clicks the shipped label.
 * 2. The dropzone copy is „Upuść plik CSV tutaj lub kliknij, aby przeglądać”
 *    and the hint lists the accepted headers (`front, back, topic, deck`).
 * 3. Step 4 says „Wpisz nazwę talii (domyślnie «Zaimportowane Fiszki»)”, but the
 *    shipped dialog has **no** deck-name field: it always creates the deck with
 *    the documented default name (`imported_deck_default_name` in the dialog,
 *    `defaultDeckName` in the import request). The expected result — a created
 *    deck holding all cards — is met with that default, so the spec asserts the
 *    default deck name and does not encode a name input that does not exist.
 * 4. The „Talia” column is optional in the case and is left unmapped here, which
 *    is the expected-result path (one deck, „Zaimportowane Fiszki”).

 * Acceptance points asserted:
 * 1. Preview: „Znaleziono 12 wierszy”, the three columns auto-mapped
 *    (`front`, `back`, `topic`), a 10-row preview out of 12 with the
 *    „Wyświetlanie 10 z 12 wierszy” counter and the „Importuj 12 fiszek” action.
 * 2. Result: „Import zakończony” / „Zaimportowano 12 z 12 fiszek”, no error table.
 * 3. The deck list then shows exactly one deck, „Zaimportowane Fiszki · 12 fiszek”.
 * 4. Opening it lists all 12 cards with the CSV's front, back and topic.
 */

const CASE = 'STU-19';

/** Polish copy from `AppFlashcardDecksPage` (pl.json) and the walk. */
const COPY = {
  importAction: 'Importuj',
  dialogTitle: 'Importuj CSV',
  dialogDesc: 'Importuj fiszki z pliku CSV',
  dropzone: 'Upuść plik CSV tutaj lub kliknij, aby przeglądać',
  hint: 'CSV musi mieć nagłówki: front, back, topic (opcjonalnie), deck (opcjonalnie)',
  rowsFound: 'Znaleziono 12 wierszy',
  previewCounter: 'Wyświetlanie 10 z 12 wierszy',
  importConfirm: 'Importuj 12 fiszek',
  done: 'Import zakończony',
  summary: 'Zaimportowano 12 z 12 fiszek',
  close: 'Zamknij',
  manage: 'Zarządzaj',
  defaultDeck: 'Zaimportowane Fiszki',
  cardCount: '12 fiszek',
  emptyDeckCount: '0 talii',
  deckCount: '1 talia',
  headers: ['#', 'Przód (Pytanie)', 'Tył (Odpowiedź)', 'Tematy (Opcjonalnie)'],
} as const;

/** The case's `fiszki_poprawne.csv`: 12 rows, three topics round-robin. */
const ROW_COUNT = 12;
const PREVIEW_LIMIT = 10;

function frontText(row: number): string {
  return `Pytanie ${row}`;
}

function backText(row: number): string {
  return `Odpowiedz ${row}`;
}

function topicText(row: number): string {
  return `Temat ${((row - 1) % 3) + 1}`;
}

function correctCsv(): string {
  const lines = ['front,back,topic'];
  for (let row = 1; row <= ROW_COUNT; row++) {
    lines.push(`${frontText(row)},${backText(row)},${topicText(row)}`);
  }
  return `${lines.join('\n')}\n`;
}

/** The import dialog (`DialogContent` in `import-dialog.tsx`). */
function importDialog(page: Page) {
  return page.getByRole('dialog');
}

test.describe('@case:STU-19 @area:STU @prio:P1 student CSV import', () => {
  test('previews a correct 12-row CSV and imports every card into the default deck with topics', async ({
    page,
  }) => {
    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

    // --- Prerequisite: a fresh student with an empty deck list --------------
    await page.goto('/app/flashcards');
    await expect(page.getByText(COPY.emptyDeckCount, { exact: true })).toBeVisible();

    // --- Step 1: „Importuj” on the deck list -------------------------------
    await page.getByRole('button', { name: COPY.importAction, exact: true }).click();
    const dialog = importDialog(page);
    await expect(
      dialog.getByRole('heading', { name: COPY.dialogTitle, exact: true }),
    ).toBeVisible();
    await expect(dialog.getByText(COPY.dialogDesc, { exact: true })).toBeVisible();

    // --- Step 2: drop (here: choose) the CSV file ---------------------------
    await expect(dialog.getByText(COPY.dropzone, { exact: true })).toBeVisible();
    await expect(dialog.getByText(COPY.hint, { exact: true })).toBeVisible();

    const fileInput = dialog.locator('input[type="file"]');
    await expect(fileInput, 'the dropzone has one CSV input').toHaveCount(1);
    await fileInput.setInputFiles({
      name: 'fiszki_poprawne.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(correctCsv(), 'utf8'),
    });

    // --- Step 3: preview and column mapping --------------------------------
    await expect(dialog.getByText(COPY.rowsFound, { exact: true })).toBeVisible();

    // The headers `front`, `back`, `topic` are mapped automatically; `deck`
    // stays unmapped, so the preview has no deck column.
    const selects = dialog.locator('select');
    await expect(selects, 'front, back, topic and deck pickers').toHaveCount(4);
    await expect(selects.nth(0), 'front column').toHaveValue('front');
    await expect(selects.nth(1), 'back column').toHaveValue('back');
    await expect(selects.nth(2), 'topic column').toHaveValue('topic');
    await expect(selects.nth(3), 'deck column stays unmapped').toHaveValue('');

    await expect(dialog.locator('thead th')).toHaveText([...COPY.headers]);

    const previewRows = dialog.locator('tbody tr');
    await expect(previewRows, `only the first ${PREVIEW_LIMIT} rows are previewed`).toHaveCount(
      PREVIEW_LIMIT,
    );
    for (let index = 0; index < PREVIEW_LIMIT; index++) {
      const row = previewRows.nth(index);
      const rowNumber = index + 1;
      await expect(row.locator('td').nth(0)).toHaveText(String(rowNumber));
      await expect(row.locator('td').nth(1)).toHaveText(frontText(rowNumber));
      await expect(row.locator('td').nth(2)).toHaveText(backText(rowNumber));
      await expect(row.locator('td').nth(3)).toHaveText(topicText(rowNumber));
    }
    // Rows past the preview cap are not rendered, and the counter says so.
    await expect(dialog.getByText(frontText(ROW_COUNT), { exact: true })).toHaveCount(0);
    await expect(dialog.getByText(COPY.previewCounter, { exact: true })).toBeVisible();

    // --- Step 4: import ----------------------------------------------------
    const confirm = dialog.getByRole('button', { name: COPY.importConfirm, exact: true });
    await expect(confirm).toBeVisible();
    await confirm.click();

    await expect(dialog.getByText(COPY.done, { exact: true })).toBeVisible();
    await expect(dialog.getByText(COPY.summary, { exact: true })).toBeVisible();
    await expect(dialog.getByText(/błęd/i), 'a correct CSV produces no error table').toHaveCount(0);

    await dialog.getByRole('button', { name: COPY.close, exact: true }).click();
    await expect(importDialog(page)).toHaveCount(0);

    // --- Expected result: one deck with all cards -------------------------
    await expect(page.getByText(COPY.deckCount, { exact: true })).toBeVisible();

    const deckCard = page
      .locator('[data-slot="card"]')
      .filter({ has: page.getByText(COPY.defaultDeck, { exact: true }) });
    await expect(deckCard, 'the import created exactly one deck').toHaveCount(1);
    // The deck card renders its mobile and desktop body in the same DOM node, so
    // the counter is asserted on the card text rather than on one badge.
    await expect(deckCard, 'the deck holds every imported card').toContainText(COPY.cardCount);

    await deckCard.getByRole('button', { name: COPY.manage, exact: true }).click();

    // --- The created deck holds every CSV row with its topic --------------
    await expect(page).toHaveURL(/\/app\/flashcards\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { name: COPY.defaultDeck, exact: true })).toBeVisible();
    await expect(page.getByText(COPY.cardCount, { exact: true })).toBeVisible();

    const cards = page.locator('[data-slot="card"][id^="fc-"]');
    await expect(cards, 'all imported flashcards are in the deck').toHaveCount(ROW_COUNT);

    for (let row = 1; row <= ROW_COUNT; row++) {
      const card = cards.filter({ has: page.getByText(frontText(row), { exact: true }) });
      await expect(card, `exactly one card for „${frontText(row)}”`).toHaveCount(1);
      // Each card renders a mobile and a desktop body; only the visible one is
      // asserted, so the check targets what the tester actually sees.
      await expect(
        card.getByText(backText(row), { exact: true }).filter({ visible: true }),
      ).toBeVisible();
      await expect(
        card.getByText(topicText(row), { exact: true }).filter({ visible: true }),
      ).toBeVisible();
    }

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });
});
