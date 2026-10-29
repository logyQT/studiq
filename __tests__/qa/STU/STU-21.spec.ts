import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * STU-21 — Tworzenie fiszki: edytor Markdown w widoku talii (`/app/flashcards/<id>`).
 *
 * Case: „Nowa Fiszka” → wpisz pytanie i odpowiedź → użyj paska narzędzi
 * (pogrubienie, kursywa, nagłówki 1–6, listy, link, tabela) i sprawdź, że podgląd
 * po prawej renderuje Markdown na bieżąco, bez przełącznika „Edytuj/Podgląd” →
 * zapisz „Utwórz”. Expected: toast „Fiszka utworzona pomyślnie”, fiszka w talii,
 * podgląd renderuje Markdown zgodnie z formatowaniem, edytor i podgląd widoczne
 * jednocześnie, a „Link” pyta o URL i wstawia składnię Markdown.
 *
 * Tenant (deterministic, `content` profile, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts STU-21 --fresh
 *
 * gives the org `qa-stu-21-<suffix>` with a manager, an educator and the student
 * this case signs in as — every id derived from `tenantKey('qa/cases/STU-21.md',
 * 'STU-21#<suffix>', 'qa-shared')`. The case's prerequisite („Własna talia”, the
 * legacy `student1@dev.local` deck `O1S1`) maps onto that student: the spec creates
 * its own personal deck through the product API and drives the UI on it. Nothing
 * global is read or written — no admin setting, feature flag, plan, platform stat
 * or singleton row — and no other tenant.
 *
 * The walk on the shared app (:3010, Polish UI, worker qa-env-4) confirmed:
 * - „Nowa Fiszka” in the toolbar opens the dialog „Utwórz Nową Fiszkę”; the two
 *   fields are labelled „Pytanie” / „Odpowiedź” (the case's „Przód (Pytanie)” /
 *   „Tył (Odpowiedź)” wording only survives in the CSV-import dialog) with the
 *   placeholders „Wprowadź pytanie lub prompt...” / „Wprowadź odpowiedź lub
 *   wyjaśnienie...”.
 * - The right column is a live preview of both sides (~300 ms debounce). There is
 *   no edit/preview toggle and no tab strip: the two textareas and the two preview
 *   panes are on screen at the same time.
 * - The toolbar wraps the *focused* field: `**pogrubienie**`, `*kursywa*`,
 *   `# `…`###### `, `- `, `1. `; „Link” opens a popover with „URL linku” + „Wstaw”
 *   (disabled until a URL is typed) and inserts `[tekst linku](<url>)`; „Tabela”
 *   opens a 7×7 grid and inserts a GFM table of the hovered size.
 * - Saving closes the dialog, raises „Fiszka utworzona pomyślnie”, bumps the deck
 *   badge to „1 fiszka” and renders the card — whose own Markdown renderer shows
 *   the headings, list, link and table — and the card survives a reload.
 * - An empty form is refused with „Zarówno przód jak i tył są wymagane” (the field
 *   copy spells out przód/tył); the dialog stays open and nothing is written.
 */

const CASE = 'STU-21';

const FLASHCARDS_URL = '/api/v1/flashcards';
const DECKS_URL = '/api/v1/flashcards/decks';

/** Polish copy from `AppFlashcardDeckViewPage` / `FlashcardEditorComponent` (pl.json). */
const COPY = {
  newFlashcard: 'Nowa Fiszka',
  dialogTitle: 'Utwórz Nową Fiszkę',
  questionLabel: 'Pytanie',
  answerLabel: 'Odpowiedź',
  questionPlaceholder: 'Wprowadź pytanie lub prompt...',
  answerPlaceholder: 'Wprowadź odpowiedź lub wyjaśnienie...',
  create: 'Utwórz',
  link: 'Link',
  linkUrlPrompt: 'URL linku',
  linkInsert: 'Wstaw',
  table: 'Tabela',
  created: 'Fiszka utworzona pomyślnie',
  frontBackRequired: 'Zarówno przód jak i tył są wymagane',
} as const;

/** What each toolbar button inserts into the focused field (empty selection). */
const TOOLBAR_INSERTS = [
  ['Pogrubienie', '**pogrubienie**'],
  ['Kursywa', '*kursywa*'],
  ['Nagłówek 1', '# '],
  ['Nagłówek 2', '## '],
  ['Nagłówek 3', '### '],
  ['Nagłówek 4', '#### '],
  ['Nagłówek 5', '##### '],
  ['Nagłówek 6', '###### '],
  ['Lista punktowana', '- '],
  ['Lista numerowana', '1. '],
] as const;

/** The content the case types in step 2, then formats in step 3. */
const CONTENT = {
  front: '# Stolica Polski?',
  back: [
    '- **Warszawa**',
    '- Kraków',
    '',
    '[Więcej](https://pl.wikipedia.org/wiki/Warszawa)',
    '',
    '| Miasto | Rzeka |',
    '|---|---|',
    '| Warszawa | Wisła |',
  ].join('\n'),
  link: 'https://studiq.pl',
  tableMarkdown: [
    '| Header 1 | Header 2 | Header 3 |',
    '|---|---|---|',
    '| Cell | Cell | Cell |',
    '| Cell | Cell | Cell |',
  ].join('\n'),
} as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface DeckRow {
  id: string;
  name: string;
  flashcard_count: number;
  visibility?: 'personal' | 'group';
}

interface CardRow {
  id: string;
  deck_id: string;
  created_by: string;
  front: string;
  back: string;
  visibility: string;
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

/** The deck this attempt works on, named after the run so two attempts never collide. */
function deckName(tenant: QaTenant): string {
  return `STU-21 edytor ${tenant.runSuffix ?? tenant.key.slice(-6)}`;
}

/** Create the prerequisite personal deck through the product API (case: „Własna talia”). */
async function createDeck(page: Page, tenant: QaTenant): Promise<DeckRow> {
  const response = await page.request.post(DECKS_URL, { data: { name: deckName(tenant) } });
  expect(
    response.status(),
    `POST ${DECKS_URL} → ${response.status()} ${await response.text()}`,
  ).toBe(201);
  const body = (await response.json()) as ApiEnvelope<DeckRow>;
  expect(body.success, 'POST deck success flag').toBe(true);
  expect(body.data.visibility ?? 'personal', 'a new deck is personal').toBe('personal');
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

/** The newest sonner toast carrying this text (an older duplicate may still be mounted). */
function toast(page: Page, text: string): Locator {
  return page.locator('[data-sonner-toast]').filter({ hasText: text }).last();
}

/** Radix portals both toolbar popovers out of the dialog, into a popper wrapper. */
function popper(page: Page): Locator {
  return page.locator('[data-radix-popper-content-wrapper]');
}

/** The edit/preview surface of the open create dialog. */
interface Editor {
  dialog: Locator;
  questionField: Locator;
  answerField: Locator;
  questionPreview: Locator;
  answerPreview: Locator;
}

async function openEditor(page: Page, deckId: string): Promise<Editor> {
  const response = await page.goto(`/app/flashcards/${deckId}`);
  expect(response?.status(), `GET /app/flashcards/${deckId}`).toBe(200);

  await page.getByRole('button', { name: COPY.newFlashcard, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: COPY.dialogTitle })).toBeVisible();

  return {
    dialog,
    questionField: dialog.getByPlaceholder(COPY.questionPlaceholder),
    answerField: dialog.getByPlaceholder(COPY.answerPlaceholder),
    // The preview column renders one card per side; `MarkdownRenderer` lives inside.
    questionPreview: dialog.locator('div.rounded-2xl').nth(0),
    answerPreview: dialog.locator('div.rounded-2xl').nth(1),
  };
}

test.describe('@case:STU-21 @area:STU @prio:P1 flashcard Markdown editor', () => {
  test('creates a flashcard with the live Markdown preview and toolbar', async ({ page }) => {
    test.setTimeout(120_000);

    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    studentOf(tenant);

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

    // Prerequisite: the student's own deck (created through the product API).
    const deck = await createDeck(page, tenant);
    expect(deck.flashcard_count, 'the fresh deck starts empty').toBe(0);

    const editor = await openEditor(page, deck.id);
    const { dialog, questionField, answerField, questionPreview, answerPreview } = editor;

    // ── The editor and the preview are side by side, with no mode toggle ─────
    await expect(questionField, 'the question textarea').toBeVisible();
    await expect(answerField, 'the answer textarea').toBeVisible();
    await expect(questionPreview, 'the question preview').toBeVisible();
    await expect(answerPreview, 'the answer preview').toBeVisible();

    // Both the field label and the preview heading read „Pytanie”/„Odpowiedź”.
    for (const label of [COPY.questionLabel, COPY.answerLabel]) {
      const labels = dialog.getByText(label, { exact: true });
      await expect(labels, `„${label}” labels (field + preview)`).toHaveCount(2);
      await expect(labels.first()).toBeVisible();
      await expect(labels.nth(1)).toBeVisible();
    }

    // No edit/preview switch and no tab strip: nothing renders between the two.
    await expect(
      dialog.getByRole('button', { name: /podgląd|edytuj tryb|edytuj\/podgląd/i }),
      'there is no edit/preview toggle',
    ).toHaveCount(0);
    await expect(dialog.getByRole('tab'), 'there is no edit/preview tab strip').toHaveCount(0);

    // ── Step 2: the typed content previews live on the right ────────────────
    const question = 'Stolica Polski?';
    const answer = 'Warszawa';
    await questionField.fill(question);
    await expect(questionPreview, 'the question preview follows the typing').toHaveText(question);
    await answerField.fill(answer);
    await expect(answerPreview, 'the answer preview follows the typing').toHaveText(answer);
    // Both panes are still there while the fields hold text.
    await expect(questionField).toBeVisible();
    await expect(answerField).toBeVisible();

    // ── Step 3: every toolbar button inserts its Markdown syntax ────────────
    for (const [label, inserted] of TOOLBAR_INSERTS) {
      await answerField.fill('');
      await dialog.getByRole('button', { name: label, exact: true }).click();
      await expect(answerField, `„${label}” inserts ${JSON.stringify(inserted)}`).toHaveValue(
        inserted,
      );
    }

    // „Link” asks for a URL, then inserts the Markdown link into the focused field.
    await answerField.fill('');
    await dialog.getByRole('button', { name: COPY.link, exact: true }).click();
    const linkPopover = popper(page);
    await expect(linkPopover, 'the „Link” popover opens').toHaveCount(1);
    const urlInput = linkPopover.getByPlaceholder(COPY.linkUrlPrompt);
    await expect(urlInput, '„Link” asks for the URL').toBeVisible();
    const insertLink = linkPopover.getByRole('button', { name: COPY.linkInsert, exact: true });
    await expect(insertLink, '„Wstaw” is disabled until a URL is typed').toBeDisabled();

    await urlInput.fill(CONTENT.link);
    await expect(insertLink).toBeEnabled();
    await insertLink.click();
    await expect(linkPopover, 'the popover closes after inserting').toHaveCount(0);
    await expect(answerField, 'the link syntax is inserted').toHaveValue(
      `[tekst linku](${CONTENT.link})`,
    );
    const previewLink = answerPreview.getByRole('link', { name: 'tekst linku' });
    await expect(previewLink, 'the preview renders the link').toBeVisible();
    await expect(previewLink).toHaveAttribute('href', CONTENT.link);
    await expect(previewLink, 'rendered links open in a new tab').toHaveAttribute(
      'target',
      '_blank',
    );

    // „Tabela” opens the size grid; 3 × 2 inserts a 3-column, 2-row GFM table.
    await answerField.fill('');
    await dialog.getByRole('button', { name: COPY.table, exact: true }).click();
    const tablePopover = popper(page);
    await expect(tablePopover, 'the „Tabela” popover opens').toHaveCount(1);
    const tableCells = tablePopover.locator('button');
    await expect(tableCells, 'the table size grid is 7 × 7').toHaveCount(49);
    await expect(tablePopover).toContainText('1 × 1');

    await tableCells.nth(9).hover(); // row 2, column 3
    await expect(tablePopover, 'the hovered size is shown').toContainText('3 × 2');
    await tableCells.nth(9).click();
    await expect(tablePopover, 'the popover closes after inserting').toHaveCount(0);
    await expect(answerField, 'the table syntax is inserted').toHaveValue(CONTENT.tableMarkdown);
    await expect(answerPreview.getByRole('table'), 'the preview renders the table').toBeVisible();
    await expect(answerPreview.getByRole('columnheader')).toHaveCount(3);
    await expect(answerPreview.getByRole('cell')).toHaveCount(6);

    // ── Step 3 (rendering): a formatted document renders in the live preview ─
    await questionField.fill(CONTENT.front);
    await answerField.fill(CONTENT.back);

    await expect(
      questionPreview.getByRole('heading', { level: 1, name: 'Stolica Polski?' }),
      'the preview renders the Markdown heading',
    ).toBeVisible();
    await expect(answerPreview.locator('strong'), 'bold').toHaveText('Warszawa');
    await expect(answerPreview.getByRole('listitem'), 'the bullet list').toHaveCount(2);
    await expect(answerPreview.getByRole('link', { name: 'Więcej' }), 'the link').toHaveAttribute(
      'href',
      'https://pl.wikipedia.org/wiki/Warszawa',
    );
    await expect(answerPreview.getByRole('table'), 'the table').toBeVisible();
    await expect(answerPreview.getByRole('columnheader')).toHaveCount(2);
    await expect(answerPreview.getByRole('cell')).toHaveCount(2);

    // ── Step 4: save with „Utwórz” ──────────────────────────────────────────
    await dialog.getByRole('button', { name: COPY.create, exact: true }).click();
    await expect(toast(page, COPY.created), 'the „Fiszka utworzona pomyślnie” toast').toBeVisible();
    await expect(dialog, 'the dialog closes after saving').toHaveCount(0);

    await expect(
      page.locator('[data-slot="badge"]:visible').filter({ hasText: '1 fiszka' }),
      'the deck badge counts the new card',
    ).toHaveCount(1);

    // The card is stored as typed (the client normalises the Markdown on save).
    const cards = await listCards(page, deck.id);
    expect(cards, 'the deck holds exactly the card this attempt created').toHaveLength(1);
    const card = cards[0]!;
    expect(card.deck_id, 'the card belongs to this deck').toBe(deck.id);
    expect(card.created_by, 'the card belongs to the signed-in student').toBe(studentOf(tenant).id);
    expect(card.front, 'stored front').toBe(CONTENT.front);
    expect(card.back, 'stored back keeps the bold run').toContain('- **Warszawa**');
    expect(card.back, 'stored back keeps the link').toContain(
      '[Więcej](https://pl.wikipedia.org/wiki/Warszawa)',
    );
    expect(card.back, 'stored back keeps the table (remark re-pads the columns)').toMatch(
      /\|\s*Miasto\s*\|\s*Rzeka\s*\|/u,
    );

    // ── The new card is in the deck list and renders its Markdown ───────────
    const rendered = flashcardCard(page, card.id);
    await expect(rendered, 'the new card is visible in the deck').toBeVisible();
    await expect(
      rendered.getByRole('heading', { level: 1, name: 'Stolica Polski?' }),
      'the card renders the heading',
    ).toBeVisible();
    await expect(rendered.getByRole('listitem'), 'the card renders the list').toHaveCount(2);
    // `FlashcardCard` renders a mobile and a desktop row; assert the visible one.
    await expect(rendered.locator('strong:visible'), 'the card renders the bold run').toHaveText(
      'Warszawa',
    );
    await expect(
      rendered.getByRole('link', { name: 'Więcej' }),
      'the card renders the link',
    ).toHaveAttribute('href', 'https://pl.wikipedia.org/wiki/Warszawa');
    await expect(rendered.getByRole('table'), 'the card renders the table').toBeVisible();

    // A reload serves the deck from the API again — the card survives as is.
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/app/flashcards/${deck.id}$`));
    const afterReload = flashcardCard(page, card.id);
    await expect(afterReload, 'the card survives a reload').toBeVisible();
    await expect(
      afterReload.getByRole('heading', { level: 1, name: 'Stolica Polski?' }),
    ).toBeVisible();
    await expect(afterReload.getByRole('table')).toBeVisible();

    expect(pageErrors, 'the editor raises no uncaught errors').toEqual([]);
  });

  test('refuses to save a card without both sides', async ({ page }) => {
    test.setTimeout(90_000);

    const tenant = loadTenant(CASE);
    studentOf(tenant);

    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });

    // Its own deck, so the assertion on the stored cards is scoped to this attempt.
    const deck = await createDeck(page, tenant);
    const { dialog, questionField, answerField } = await openEditor(page, deck.id);

    // Both sides empty.
    await dialog.getByRole('button', { name: COPY.create, exact: true }).click();
    await expect(toast(page, COPY.frontBackRequired), 'the missing-sides toast').toBeVisible();
    await expect(dialog, 'the dialog stays open').toBeVisible();

    // Only the question filled in.
    await questionField.fill('Stolica Polski?');
    await dialog.getByRole('button', { name: COPY.create, exact: true }).click();
    await expect(toast(page, COPY.frontBackRequired)).toBeVisible();
    await expect(dialog).toBeVisible();

    // Nothing was written, and the deck badge still shows no cards.
    expect(await listCards(page, deck.id), 'a refused save writes nothing').toHaveLength(0);
    await expect(
      page.locator('[data-slot="badge"]:visible').filter({ hasText: '0 fiszek' }),
    ).toHaveCount(1);
    await expect(answerField, 'the refused answer field stays empty').toHaveValue('');
  });
});
