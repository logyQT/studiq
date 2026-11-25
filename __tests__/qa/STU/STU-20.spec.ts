import { expect, test, type Locator, type Page } from '@playwright/test';
import { z } from 'zod';
import { loadTenant, loginAs } from '#test/qa/fixtures/tenant';

/**
 * STU-20 — Import CSV – błędne dane (`/app/flashcards`, `qa/cases/STU-20.md`, #888).
 *
 * Tenant: `bun scripts/qa-tenant.ts STU-20 --fresh` (`content` profile; the student signs
 * in). Every execution imports into its own new deck, which the spec finds by difference.
 *
 * Acceptance points:
 * 1. A file mixing good rows with a missing back, a blank line and blank cells imports the
 *    good ones and lists the others as „N błędów” with „Wiersz / Błąd”, numbered as in the
 *    preview. The whole file is sent, not only what the preview shows.
 * 2. Without a front or back mapping: „Proszę przypisać kolumny Przód i Tył”.
 * 3. A .txt or .png file, picked or dropped: „Nie udało się sparsować pliku CSV”.
 * 4. Over 500 rows the real count is shown and nothing can be sent.
 */

const CASE = 'STU-20';
const IMPORT_URL = '**/api/v1/flashcards/import/csv';

const COPY = {
  importAction: 'Importuj',
  dropzone: 'Upuść plik CSV tutaj lub kliknij, aby przeglądać',
  parseError: 'Nie udało się sparsować pliku CSV',
  mapRequired: 'Proszę przypisać kolumny Przód i Tył',
  required: 'To pole jest wymagane.',
  front: 'Przód (Pytanie)',
  back: 'Tył (Odpowiedź)',
  invalid: 'Błąd walidacji danych. Sprawdź formularz.',
  limit: 'Osiągnięto limit Twojego planu.',
} as const;

/** More good rows than the 50 the dialog used to keep. */
const FILLERS = 52;
const GOOD = FILLERS + 2;
const TOTAL = FILLERS + 6;

const MIXED_CSV = [
  'front,back,topic',
  'Zażółć gęślą jaźń?,"Odpowiedź z przecinkiem, i „cudzysłowem”",Temat 1',
  'Tylko przód,,Temat 2',
  '',
  ',Tylko tył,Temat 1',
  '   ,   ,',
  '<b>€ & 😀</b>,znaki specjalne,Temat 3',
  ...Array.from({ length: FILLERS }, (_, i) => `Pytanie ${i},Odpowiedź ${i},Temat 3`),
  '',
].join('\n');

const decksSchema = z.object({
  data: z.object({ items: z.array(z.object({ id: z.string() })) }),
});
const cardsSchema = z.object({
  data: z.object({
    items: z.array(z.object({ front: z.string() })),
    nextCursor: z.string().nullable(),
  }),
});

const csvFile = (name: string, text: string, mimeType = 'text/csv') => ({
  name,
  mimeType,
  buffer: Buffer.from(text, 'utf8'),
});

async function openImportDialog(page: Page): Promise<Locator> {
  await loginAs(page, loadTenant(CASE), 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
  await page.goto('/app/flashcards');
  await page.getByRole('button', { name: COPY.importAction, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(COPY.dropzone, { exact: true })).toBeVisible();
  return dialog;
}

async function pick(dialog: Locator, file: ReturnType<typeof csvFile>): Promise<void> {
  await dialog.locator('input[type="file"]').setInputFiles(file);
}

/** A real `drop` on the dropzone, which the file input's `accept` never sees. */
async function drop(dialog: Locator, name: string, type: string, content: string) {
  const transfer = await dialog.page().evaluateHandle(
    (file) => {
      const data = new DataTransfer();
      data.items.add(new File([file.content], file.name, { type: file.type }));
      return data;
    },
    { name, type, content },
  );
  await dialog
    .getByRole('button', { name: COPY.dropzone })
    .dispatchEvent('drop', { dataTransfer: transfer });
}

async function deckIds(page: Page): Promise<string[]> {
  const response = await page.request.get('/api/v1/flashcards/decks?limit=100');
  expect(response.ok()).toBe(true);
  return decksSchema.parse(await response.json()).data.items.map((deck) => deck.id);
}

async function frontsOf(page: Page, deckId: string): Promise<string[]> {
  const fronts: string[] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({ deckIds: deckId, limit: '50' });
    if (cursor) query.set('cursor', cursor);
    const response = await page.request.get(`/api/v1/flashcards?${query.toString()}`);
    const { data } = cardsSchema.parse(await response.json());
    fronts.push(...data.items.map((card) => card.front));
    cursor = data.nextCursor;
  } while (cursor);
  return fronts;
}

test.describe('@case:STU-20 @area:STU @prio:P2 CSV import of bad data', () => {
  test('imports the good rows and lists the bad ones by row', async ({ page }) => {
    const dialog = await openImportDialog(page);
    const before = await deckIds(page);

    await pick(dialog, csvFile('fiszki_bledne.csv', MIXED_CSV));
    await expect(dialog.getByText(`Znaleziono ${TOTAL} wierszy`, { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: new RegExp(`^Importuj ${TOTAL} fisz`) }).click();

    await expect(
      dialog.getByText(`Zaimportowano ${GOOD} z ${TOTAL} fiszek`, { exact: true }),
    ).toBeVisible();
    await expect(dialog.getByText('6 błędów')).toBeVisible();
    await expect(dialog.locator('thead th')).toHaveText(['Wiersz', 'Błąd']);
    const rows = await dialog
      .locator('tbody tr')
      .evaluateAll((trs) => trs.map((tr) => [...tr.children].map((td) => td.textContent)));
    const missing = (row: number, column: string) => [String(row), `${column}: ${COPY.required}`];
    expect(rows).toEqual([
      missing(2, COPY.back),
      missing(3, COPY.front),
      missing(3, COPY.back),
      missing(4, COPY.front),
      missing(5, COPY.front),
      missing(5, COPY.back),
    ]);

    const added = (await deckIds(page)).filter((id) => !before.includes(id));
    expect(added).toHaveLength(1);
    const fronts = await frontsOf(page, added[0] ?? '');
    expect(fronts).toHaveLength(GOOD);
    expect(fronts).toContain('Zażółć gęślą jaźń?');
    expect(fronts).toContain('<b>€ & 😀</b>');
    expect(fronts).toContain(`Pytanie ${FILLERS - 1}`);
    expect(fronts).not.toContain('Tylko przód');
  });

  test('asks for both columns when one is left unmapped, and translates a refusal', async ({
    page,
  }) => {
    const dialog = await openImportDialog(page);
    let requests = 0;
    await page.route(IMPORT_URL, async (route) => {
      requests += 1;
      await route.fulfill({ status: 429, json: { success: false, error: 'USAGE_LIMIT_EXCEEDED' } });
    });

    await pick(dialog, csvFile('fiszki.csv', 'front,back\nq,a\n'));
    const [front, back] = [dialog.locator('select').nth(0), dialog.locator('select').nth(1)];
    await expect(front).toHaveValue('front');
    await expect(back).toHaveValue('back');
    const confirm = dialog.getByRole('button', { name: /^Importuj 1 fisz/ });

    await front.selectOption('');
    await confirm.click();
    await expect(page.getByText(COPY.mapRequired, { exact: true })).toBeVisible();
    expect(requests).toBe(0);

    await front.selectOption('front');
    await confirm.click();
    await expect(page.getByText(COPY.limit, { exact: true })).toBeVisible();
    await expect(page.getByText('USAGE_LIMIT_EXCEEDED')).toHaveCount(0);
    expect(requests).toBe(1);
  });

  const wrongFiles = [
    { name: 'notatka.txt', type: 'text/plain', content: 'To jest zwykły tekst,\nnie CSV.' },
    { name: 'obrazek.png', type: 'image/png', content: '\u0089PNG\r\n\u001a\nIHDR' },
  ];

  for (const file of wrongFiles) {
    for (const way of ['picked', 'dropped'] as const) {
      test(`refuses ${file.name} when it is ${way}`, async ({ page }) => {
        const dialog = await openImportDialog(page);

        if (way === 'picked') await pick(dialog, csvFile(file.name, file.content, file.type));
        else await drop(dialog, file.name, file.type, file.content);

        await expect(page.getByText(COPY.parseError, { exact: true })).toBeVisible();
        await expect(dialog.getByText(COPY.dropzone, { exact: true })).toBeVisible();
        await expect(dialog.locator('select')).toHaveCount(0);
      });
    }
  }

  test('accepts a dropped CSV, so the refusals above are about the file', async ({ page }) => {
    const dialog = await openImportDialog(page);

    await drop(dialog, 'fiszki.csv', 'text/csv', 'front,back\nq,a\n');

    await expect(dialog.getByText('Znaleziono 1 wiersz', { exact: true })).toBeVisible();
  });

  test('shows the real row count and sends nothing past 500 rows', async ({ page }) => {
    const dialog = await openImportDialog(page);
    const text = ['front,back', ...Array.from({ length: 501 }, (_, i) => `q${i},a`)].join('\n');

    await pick(dialog, csvFile('duzy.csv', text));

    await expect(dialog.getByText('Znaleziono 501 wierszy', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('alert')).toHaveText(COPY.invalid);
    await expect(dialog.getByRole('button', { name: /^Importuj 501 / })).toBeDisabled();
  });
});
