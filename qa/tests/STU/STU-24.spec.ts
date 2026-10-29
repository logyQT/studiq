import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * STU-24 — Tematy fiszki: dodawanie i usuwanie (`/app/flashcards/<id>`).
 *
 * Case steps: on a flashcard in a deck, „Tematy › Dodaj Temat”, type „Nowy temat”
 * and pick „Utwórz „Nowy temat””, then add an existing topic from the list; open
 * „Tematy › Zarządzaj Tematami”, remove one topic and save; finally use „Tematy ›
 * Zobacz według Tematu”.
 *
 * Tenant (deterministic, `content` profile, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts STU-24 --fresh
 *
 * gives the org `qa-stu-24-<suffix>` with a manager, an educator and a student,
 * where every id derives from
 * `tenantKey('qa/cases/STU-24.md', 'STU-24#<suffix>', 'qa-shared')` + `tenantId`.
 * Nothing global is read or written: no admin setting, feature flag, plan,
 * platform stat or singleton row. The spec builds its own deck, card and the
 * „existing” topic through the product API as that student, so the card starts
 * with no topics and the list of assignable topics is exactly the tenant's.
 *
 * The case was written against the legacy seed (`student1@dev.local`, password
 * `pass`, personal deck `O1S1`); the suite version uses the tenant student.
 *
 * Acceptance points confirmed on the shared app during the walk (2026-10-29):
 * 1. The card's menu is „Więcej akcji fiszki” → „Tematy” with „Dodaj Temat”,
 *    „Zarządzaj Tematami” and „Zobacz według Tematu”.
 * 2. „Dodaj Temat” opens the dialog „Dodaj Temat” / „Wpisz nazwę, aby utworzyć
 *    nowy temat, lub wybierz istniejący” with the empty field „Nazwa tematu...” and
 *    the not-yet-assigned topics. Typing a name with no match shows both the
 *    „Utwórz „Nowy temat”” row and the case's „Nie znaleziono pasujących
 *    tematów” copy. Choosing the create row stores the topic, assigns it to the
 *    card, shows „Temat dodany” and renders the topic as a badge on the card.
 * 3. Choosing an existing topic from the same list assigns it and shows „Temat
 *    dodany”; the already-assigned topic is no longer offered.
 * 4. „Zarządzaj Tematami” opens „Zarządzaj Tematami” / „Dodaj lub usuń tematy z
 *    tej fiszki” with the card's topics as removable chips. Removing one and
 *    saving shows „Temat usunięty”, drops that badge and keeps the other. The
 *    dialog's confirm button is „Zapisz” (the case's „Usuń Tematy” is the label of
 *    the separate multi-card bulk operation, not this per-card dialog); the
 *    expected result — toast „Temat usunięty” + badge gone — is what is asserted.
 * 5. „Zobacz według Tematu” opens a dialog titled with the card's first assigned
 *    topic, counts the deck's cards carrying it („1 fiszka z tym tematem”) and
 *    lists their question/answer. The case's empty branch („Brak fiszek z tym
 *    tematem”) cannot be reached from this menu entry: it only opens for a card
 *    that already has the topic, so the count is never 0. The empty branch lives
 *    on the topics screen (`/app/topics`), outside this case's surface.
 *
 * Retry safety: CI seeds a tenant once and retries against it, so every execution
 * resets its own rows first — the deck (deleting it cascades its cards) and both
 * topic names — then re-creates them. The second attempt therefore starts from
 * the same first-run state as the first.
 */

const CASE = 'STU-24';

/** The case's own topic, the pre-existing one, and the deck/card the walk uses. */
const NEW_TOPIC = 'Nowy temat';
const EXISTING_TOPIC = 'STU-24 istniejący';
const CARD_FRONT = 'STU-24 fiszka 1';
const CARD_BACK = 'Odpowiedź 1';

/** Polish copy from `Flashcards` / `Common` / `A11y` in `pl.json` (verified on the app). */
const COPY = {
  moreActions: 'Więcej akcji fiszki',
  topicsMenu: 'Tematy',
  addTopic: 'Dodaj Temat',
  addDesc: 'Wpisz nazwę, aby utworzyć nowy temat, lub wybierz istniejący',
  addPlaceholder: 'Nazwa tematu...',
  noMatches: 'Nie znaleziono pasujących tematów',
  added: 'Temat dodany',
  removed: 'Temat usunięty',
  manageTopics: 'Zarządzaj Tematami',
  manageDesc: 'Dodaj lub usuń tematy z tej fiszki',
  save: 'Zapisz',
  viewByTopic: 'Zobacz według Tematu',
  close: 'Zamknij',
} as const;

/** `view_flashcards_for_topic` for a single card. */
const ONE_CARD_FOR_TOPIC = '1 fiszka z tym tematem';

const DECKS_URL = '/api/v1/flashcards/decks';
const FLASHCARDS_URL = '/api/v1/flashcards';
const TOPICS_URL = '/api/v1/flashcards/topics';

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface DeckRow {
  id: string;
  name: string;
}

interface TopicRow {
  id: string;
  name: string;
}

interface FlashcardRow {
  id: string;
  front: string;
  back: string;
  flashcard_topic_assignments?: { topic_id: string }[];
}

/** `GET` an endpoint as the signed-in student and unwrap the response envelope. */
async function getData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.ok(), `GET ${url} → ${response.status()} ${await response.text()}`).toBe(true);
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data;
}

/** The deck's name carries the tenant's run suffix, so two runs never share a deck. */
function deckName(tenant: QaTenant): string {
  return `STU-24 talia ${tenant.runSuffix ?? 'stable'}`;
}

async function listDecks(page: Page): Promise<DeckRow[]> {
  const data = await getData<{ items: DeckRow[] }>(page, `${DECKS_URL}?limit=200`);
  return data.items;
}

async function listTopics(page: Page): Promise<TopicRow[]> {
  const data = await getData<{ items: TopicRow[] }>(page, `${TOPICS_URL}?limit=200`);
  return data.items;
}

/** Delete every deck with this exact name; a deck delete cascades its flashcards. */
async function deleteDecksNamed(page: Page, name: string): Promise<void> {
  for (const deck of (await listDecks(page)).filter((row) => row.name === name)) {
    const response = await page.request.delete(`${DECKS_URL}/${deck.id}`);
    expect(
      response.status(),
      `DELETE ${DECKS_URL}/${deck.id} (${name}) → ${await response.text()}`,
    ).toBe(200);
  }
}

/** Delete every topic with this exact name; the delete cascades its assignments. */
async function deleteTopicsNamed(page: Page, name: string): Promise<void> {
  for (const topic of (await listTopics(page)).filter((row) => row.name === name)) {
    const response = await page.request.delete(`${TOPICS_URL}/${topic.id}`);
    expect(
      response.status(),
      `DELETE ${TOPICS_URL}/${topic.id} (${name}) → ${await response.text()}`,
    ).toBe(200);
  }
}

async function createDeck(page: Page, name: string): Promise<DeckRow> {
  const response = await page.request.post(DECKS_URL, {
    data: { name, visibility: 'personal' },
  });
  expect(
    response.status(),
    `POST ${DECKS_URL} (${name}) → ${response.status()} ${await response.text()}`,
  ).toBe(201);
  const body = (await response.json()) as ApiEnvelope<DeckRow>;
  expect(body.success, 'deck create success flag').toBe(true);
  return body.data;
}

/** The deck's one card — the case's „fiszka” the topics are attached to. */
async function createCard(page: Page, deckId: string): Promise<FlashcardRow> {
  const response = await page.request.post(FLASHCARDS_URL, {
    data: { deckId, front: CARD_FRONT, back: CARD_BACK },
  });
  expect(
    response.status(),
    `POST ${FLASHCARDS_URL} (${CARD_FRONT}) → ${response.status()} ${await response.text()}`,
  ).toBe(201);
  const body = (await response.json()) as ApiEnvelope<FlashcardRow>;
  expect(body.success, 'flashcard create success flag').toBe(true);
  return body.data;
}

/** The topic the „Dodaj Temat” list offers in step 2 (the legacy seed's analogue). */
async function createTopic(page: Page, name: string): Promise<TopicRow> {
  const response = await page.request.post(TOPICS_URL, { data: { name } });
  expect(
    response.status(),
    `POST ${TOPICS_URL} (${name}) → ${response.status()} ${await response.text()}`,
  ).toBe(201);
  const body = (await response.json()) as ApiEnvelope<TopicRow>;
  expect(body.success, 'topic create success flag').toBe(true);
  return body.data;
}

/** The deck's cards as the API returns them (the same rows the screen renders). */
async function listCards(page: Page, deckId: string): Promise<FlashcardRow[]> {
  const data = await getData<{ items: FlashcardRow[] }>(
    page,
    `${FLASHCARDS_URL}?deckIds=${deckId}&sortBy=created_at&sortOrder=desc&limit=30`,
  );
  return data.items;
}

/** The topic ids assigned to the deck's single card, sorted for a stable compare. */
async function assignedTopicIds(page: Page, deckId: string): Promise<string[]> {
  const cards = await listCards(page, deckId);
  expect(cards, 'the deck holds exactly the case’s card').toHaveLength(1);
  return (cards[0].flashcard_topic_assignments ?? []).map((a) => a.topic_id).sort();
}

/**
 * The visible copy of a card string. `FlashcardCard` renders the same question,
 * answer and topic badges twice — a compact mobile row (`sm:hidden`) and the
 * desktop row — so an unscoped `getByText` matches both.
 */
function cardText(card: Locator, text: string): Locator {
  return card.getByText(text, { exact: true }).filter({ visible: true });
}

/** The sonner toast carrying this text. */
function toast(page: Page, text: string): Locator {
  return page.locator('[data-sonner-toast]').filter({ hasText: text });
}

/** Sonner keeps a toast for 4 s; wait it out so the next step's toast is the new one. */
async function waitForToastsToClear(page: Page): Promise<void> {
  await expect(page.locator('[data-sonner-toast]'), 'no toast from the previous step').toHaveCount(
    0,
    { timeout: 15_000 },
  );
}

/** The card's own „Więcej akcji fiszki” trigger (the mobile duplicate is `display:none`). */
function cardMenuTrigger(card: Locator): Locator {
  return card.getByRole('button', { name: COPY.moreActions }).first();
}

/** Open „Tematy” on the card and pick one of its three entries. */
async function openCardTopicEntry(page: Page, card: Locator, entry: string): Promise<void> {
  await card.hover();
  await cardMenuTrigger(card).click();
  const topics = page.getByRole('menuitem', { name: COPY.topicsMenu, exact: true });
  await expect(topics, 'the card menu has a „Tematy” submenu').toBeVisible();
  await topics.hover();
  const item = page.getByRole('menuitem', { name: entry, exact: true });
  await expect(item, `the „Tematy” submenu offers „${entry}”`).toBeVisible();
  await item.click();
}

/** The open dialog (Radix unmounts a closed one, so exactly one matches). */
function dialog(page: Page): Locator {
  return page.getByRole('dialog');
}

test.describe('@case:STU-24 @area:STU @prio:P2 flashcard topics add/remove/view', () => {
  test('adds a new and an existing topic to a card, removes one and views the card by topic', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    const student = tenant.users.student;
    if (!student) throw new Error(`${CASE} needs the content tenant profile (student account)`);

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // ── Tenant prep ─────────────────────────────────────────────────────────
    // Log in first: the org cookie is what scopes the content the spec creates,
    // and a CI retry reuses this tenant, so the deck and both topics are reset.
    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
    expect(new URL(page.url()).pathname, 'the student lands on /app').toBe('/app');
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

    const name = deckName(tenant);
    await deleteDecksNamed(page, name);
    await deleteTopicsNamed(page, NEW_TOPIC);
    await deleteTopicsNamed(page, EXISTING_TOPIC);

    const deck = await createDeck(page, name);
    const cardData = await createCard(page, deck.id);
    const existingTopic = await createTopic(page, EXISTING_TOPIC);

    // ── Prerequisite: the deck with its flashcard ───────────────────────────
    await page.goto(`/app/flashcards/${deck.id}`);
    await expect(page).toHaveURL(new RegExp(`/app/flashcards/${deck.id}$`));

    const card = page.locator(`#fc-${cardData.id}`);
    await expect(card, 'the deck renders its flashcard').toBeVisible();
    await expect(cardText(card, CARD_FRONT)).toBeVisible();
    await expect(cardText(card, CARD_BACK)).toBeVisible();
    expect(await assignedTopicIds(page, deck.id), 'the card starts with no topics').toEqual([]);

    // ── Step 1: create „Nowy temat” from the add-topic dialog ───────────────
    await openCardTopicEntry(page, card, COPY.addTopic);
    const addDialog = dialog(page);
    await expect(
      addDialog.getByRole('heading', { name: COPY.addTopic, exact: true }),
    ).toBeVisible();
    await expect(addDialog.getByText(COPY.addDesc, { exact: true })).toBeVisible();

    const nameInput = addDialog.getByPlaceholder(COPY.addPlaceholder);
    await expect(nameInput, 'a new topic starts from an empty name').toHaveValue('');
    await expect(
      addDialog.getByRole('button', { name: EXISTING_TOPIC, exact: true }),
      'the existing tenant topic is offered',
    ).toBeVisible();

    await nameInput.fill(NEW_TOPIC);
    const createRow = addDialog.getByRole('button', { name: `Utwórz "${NEW_TOPIC}"`, exact: true });
    await expect(createRow, 'the typed name can be created').toBeVisible();
    await expect(
      addDialog.getByText(COPY.noMatches, { exact: true }),
      'a query with no matching topic shows the case’s copy',
    ).toBeVisible();

    await createRow.click();
    await expect(toast(page, COPY.added), 'the „Temat dodany” toast').toBeVisible();
    await expect(addDialog, 'the dialog closes after creating the topic').toBeHidden();
    await expect(cardText(card, NEW_TOPIC), 'the new topic is a badge on the card').toBeVisible();

    const createdTopic = (await listTopics(page)).find((topic) => topic.name === NEW_TOPIC);
    if (!createdTopic) throw new Error(`the „${NEW_TOPIC}” topic was not stored`);
    expect(await assignedTopicIds(page, deck.id), 'the new topic is assigned to the card').toEqual([
      createdTopic.id,
    ]);

    // ── Step 2: add an existing topic from the list ─────────────────────────
    await waitForToastsToClear(page);
    await openCardTopicEntry(page, card, COPY.addTopic);
    await expect(
      addDialog.getByRole('button', { name: EXISTING_TOPIC, exact: true }),
      'the existing topic is still offered',
    ).toBeVisible();
    await expect(
      addDialog.getByRole('button', { name: NEW_TOPIC, exact: true }),
      'a topic already on the card is not offered again',
    ).toHaveCount(0);

    await addDialog.getByRole('button', { name: EXISTING_TOPIC, exact: true }).click();
    await expect(toast(page, COPY.added), 'the second „Temat dodany” toast').toBeVisible();
    await expect(addDialog).toBeHidden();
    await expect(
      cardText(card, EXISTING_TOPIC),
      'the existing topic is a badge on the card',
    ).toBeVisible();
    expect(await assignedTopicIds(page, deck.id), 'both topics are assigned to the card').toEqual(
      [createdTopic.id, existingTopic.id].sort(),
    );

    // ── Step 3: „Zarządzaj Tematami” — remove one topic ─────────────────────
    await waitForToastsToClear(page);
    await openCardTopicEntry(page, card, COPY.manageTopics);
    const manageDialog = dialog(page);
    await expect(
      manageDialog.getByRole('heading', { name: COPY.manageTopics, exact: true }),
    ).toBeVisible();
    await expect(manageDialog.getByText(COPY.manageDesc, { exact: true })).toBeVisible();

    const chips = manageDialog.locator('[data-slot="badge"]');
    await expect(
      chips.filter({ hasText: NEW_TOPIC }),
      'the card’s new topic is a removable chip',
    ).toBeVisible();
    await expect(chips.filter({ hasText: EXISTING_TOPIC })).toBeVisible();

    await chips.filter({ hasText: NEW_TOPIC }).getByRole('button').click();
    await expect(
      chips.filter({ hasText: NEW_TOPIC }),
      'the removed topic leaves the selection',
    ).toHaveCount(0);

    await manageDialog.getByRole('button', { name: COPY.save, exact: true }).click();
    await expect(toast(page, COPY.removed), 'the „Temat usunięty” toast').toBeVisible();
    await expect(manageDialog, 'the dialog closes after saving').toBeHidden();
    await expect(
      cardText(card, NEW_TOPIC),
      'the removed topic is no longer a badge on the card',
    ).toHaveCount(0);
    await expect(cardText(card, EXISTING_TOPIC), 'the other topic stays on the card').toBeVisible();
    expect(await assignedTopicIds(page, deck.id), 'only the kept topic is assigned').toEqual([
      existingTopic.id,
    ]);

    // ── Step 4: „Zobacz według Tematu” ──────────────────────────────────────
    await openCardTopicEntry(page, card, COPY.viewByTopic);
    const viewDialog = dialog(page);
    await expect(
      viewDialog.getByRole('heading', { name: EXISTING_TOPIC }),
      'the dialog is titled with the card’s topic',
    ).toBeVisible();
    await expect(
      viewDialog.getByText(ONE_CARD_FOR_TOPIC, { exact: true }),
      'the dialog counts the cards carrying the topic',
    ).toBeVisible();
    await expect(
      viewDialog.getByText(CARD_FRONT, { exact: true }),
      'the card carrying the topic is listed',
    ).toBeVisible();
    await expect(viewDialog.getByText(CARD_BACK, { exact: true })).toBeVisible();
    await viewDialog.getByRole('button', { name: COPY.close, exact: true }).click();
    await expect(viewDialog).toBeHidden();

    // The badges come from the API, not from the mutation's cache patch.
    await page.reload();
    await expect(cardText(card, EXISTING_TOPIC)).toBeVisible();
    await expect(cardText(card, NEW_TOPIC)).toHaveCount(0);

    expect(pageErrors, 'uncaught page errors on the deck page').toEqual([]);
  });
});
