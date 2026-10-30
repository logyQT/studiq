import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * EDU-DECK-04 — Fiszki w talii nauczyciela (/edu/flashcards/<deckId>).
 *
 * Prerequisite (reconciled with the tenant seeder): EDU-DECK-02 has already left a
 * group deck named „Matematyka – klasa 1” shared to the tenant group `G1`, owned by
 * the organization's teacher. The case's legacy accounts (`teacher1@dev.local`,
 * password `pass`) are never used.
 *
 * Tenant: the `content` profile, seeded once before Playwright starts
 * (`bun scripts/qa-tenant.ts EDU-DECK-04 --fresh`) and read through
 * `loadTenant(CASE)` — the spec never seeds at runtime:
 *   - `teacher` is the organization's educator and a member of the default group
 *     `G1`; only a group *teacher* may share content with a group, so the spec
 *     promotes it through the manager's own group-roster endpoint first (the same
 *     write `/manage/groups` performs, tenant-local and idempotent);
 *   - `student` is an org member and a `G1` member (the group the deck is shared
 *     with) — a prerequisite, not a subject of this case.
 * Nothing global is written: no admin setting, feature flag, plan, platform stat or
 * singleton row. The deck, the topic and the cards are created through the product
 * API inside this tenant.
 *
 * Acceptance points (walked on the shared app before writing the test):
 * 1. „Dodaj fiszkę” opens „Utwórz Nową Fiszkę”; the right-hand pane renders the
 *    typed Markdown live (no edit/preview toggle), and „Utwórz” answers the toast
 *    „Fiszka utworzona pomyślnie”. The card shows „2+2” / „4”, the deck counter
 *    turns to „1 fiszka” and the API stores the card in this deck.
 * 2. „Edytuj” from the card menu opens „Edytuj Fiszkę” with the current values;
 *    „Aktualizuj” answers „Fiszka zaktualizowana pomyślnie” and the new front/back
 *    appear immediately on the card and in the API.
 * 3. „Usuń” asks „Usunąć Fiszkę?” / „To trwale usunie fiszkę. Tej akcji nie można
 *    cofnąć.”; confirming answers „Fiszka usunięta”, empties the list and the API.
 * 4. Creating again with a topic attached in the same dialog („Wybierz tematy”)
 *    stores the assignment, shows the topic chip on the card and exposes the topic
 *    in the deck's topic filter.
 */

const CASE = 'EDU-DECK-04';

const DECK_NAME = 'Matematyka – klasa 1';
const TOPIC_NAME = 'Arytmetyka';

/** The case's two card generations: the CRUD pass, then the topic pass. */
const CARD = { front: '2+2', back: '4' } as const;
const EDITED = { front: '2+3', back: '5' } as const;
const TOPIC_CARD = { front: '3+3', back: '6' } as const;

/** Polish copy the case quotes, as rendered by the current product. */
const COPY = {
  addCard: 'Dodaj fiszkę',
  createTitle: 'Utwórz Nową Fiszkę',
  editTitle: 'Edytuj Fiszkę',
  create: 'Utwórz',
  update: 'Aktualizuj',
  moreActions: 'Więcej akcji fiszki',
  menuEdit: 'Edytuj',
  menuDelete: 'Usuń',
  deleteTitle: 'Usunąć Fiszkę?',
  deleteDescription: 'To trwale usunie fiszkę. Tej akcji nie można cofnąć.',
  confirmDelete: 'Usuń',
  created: 'Fiszka utworzona pomyślnie',
  updated: 'Fiszka zaktualizowana pomyślnie',
  deleted: 'Fiszka usunięta',
  topicsPlaceholder: 'Wybierz tematy',
  topicFilterAll: 'Wszystkie tematy',
  empty: 'Nic tutaj jeszcze nie ma, stwórz swoją pierwszą fiszkę!',
} as const;

/** Polish plural for the deck counter badge (`flashcards_count`). */
function cardsCountLabel(count: number): string {
  if (count === 1) return '1 fiszka';
  if (count >= 2 && count <= 4) return `${count} fiszki`;
  return `${count} fiszek`;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface DeckRow {
  id: string;
  name: string;
  visibility: 'personal' | 'group';
  groupIds: string[];
}

interface FlashcardRow {
  id: string;
  deck_id: string;
  front: string;
  back: string;
  flashcard_topic_assignments: { topic_id: string }[];
}

interface TopicRow {
  id: string;
  name: string;
}

interface GroupMemberRow {
  userId: string;
  role: 'teacher' | 'member';
}

/** `GET` an endpoint as the signed-in user and unwrap the response envelope. */
async function getData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.ok(), `GET ${url} → ${response.status()} ${await response.text()}`).toBe(true);
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data;
}

/** Cards of the tenant deck, as the deck screen lists them. */
async function listCards(page: Page, deckId: string): Promise<FlashcardRow[]> {
  const data = await getData<{ items: FlashcardRow[] }>(
    page,
    `/api/v1/flashcards?deckIds=${deckId}&limit=100`,
  );
  return data.items;
}

/** The tenant's decks, as the deck list API returns them. */
async function listDecks(page: Page): Promise<DeckRow[]> {
  return (await getData<{ items: DeckRow[] }>(page, '/api/v1/flashcards/decks?limit=100')).items;
}

/**
 * The tenant seeder enrols group members with the group `member` role, but only a
 * group `teacher` may share a deck to the group (`canShareContentToGroups`). Promote
 * the educator through the manager's own roster endpoint — the same write
 * `/manage/groups` performs — keeping every other member untouched.
 */
async function ensureEducatorLeadsGroup(page: Page, tenant: QaTenant): Promise<void> {
  const groupId = tenant.group?.id;
  const educator = tenant.users.teacher;
  if (!groupId || !educator) {
    throw new Error(`${CASE} needs the content tenant profile (org, group and educator)`);
  }

  const url = `/api/v1/organization/groups/${groupId}/members`;
  const roster = await getData<GroupMemberRow[]>(page, url);
  const member = roster.find((row) => row.userId === educator.id);
  expect(member, 'the seeded educator is a member of the tenant group').toBeTruthy();
  if (member!.role === 'teacher') return;

  const response = await page.request.put(url, {
    data: {
      members: roster.map((row) =>
        row.userId === educator.id ? { userId: row.userId, role: 'teacher' } : row,
      ),
    },
  });
  expect(response.ok(), `PUT ${url} → ${response.status()} ${await response.text()}`).toBe(true);

  const after = await getData<GroupMemberRow[]>(page, url);
  expect(
    after.find((row) => row.userId === educator.id)?.role,
    'the educator now teaches the tenant group',
  ).toBe('teacher');
}

/**
 * A retry against the same seeded tenant must start from the same state: drop the
 * decks a previous run left behind so the deck screen is empty again. Only this
 * case's own decks (same name, same tenant) are touched.
 */
async function resetDecks(page: Page): Promise<void> {
  for (const deck of (await listDecks(page)).filter((row) => row.name === DECK_NAME)) {
    const response = await page.request.delete(`/api/v1/flashcards/decks/${deck.id}`);
    expect(response.ok(), `DELETE /api/v1/flashcards/decks/${deck.id} → ${response.status()}`).toBe(
      true,
    );
  }
}

/** The tenant's topic, created once per tenant (a re-run reuses it). */
async function ensureTopic(page: Page): Promise<TopicRow> {
  const { items } = await getData<{ items: TopicRow[] }>(
    page,
    '/api/v1/flashcards/topics?limit=100',
  );
  const existing = items.find((row) => row.name === TOPIC_NAME);
  if (existing) return existing;

  const response = await page.request.post('/api/v1/flashcards/topics', {
    data: { name: TOPIC_NAME },
  });
  expect(
    response.status(),
    `POST /api/v1/flashcards/topics → ${response.status()} ${await response.text()}`,
  ).toBe(201);
  return ((await response.json()) as ApiEnvelope<TopicRow>).data;
}

/** The deck screen's card element (`<Card id="fc-<flashcard id>">`). */
function cardById(page: Page, id: string): Locator {
  return page.locator(`#fc-${id}`);
}

/** The open dialog on the deck screen (create, edit or delete confirmation). */
function dialog(page: Page): Locator {
  return page.locator('[data-slot="dialog-content"]');
}

/** The deck counter badge shows the given number of cards with Polish inflection. */
async function expectCardsCount(page: Page, count: number): Promise<void> {
  await expect(page.getByText(cardsCountLabel(count), { exact: true }).first()).toBeVisible();
}

function editorTextareas(page: Page) {
  const fields = dialog(page).locator('textarea');
  return { front: fields.nth(0), back: fields.nth(1) };
}

/** Open the card's „…” menu and pick an item (the trigger only shows on hover). */
async function openCardMenu(page: Page, card: Locator): Promise<void> {
  await card.hover();
  await card.getByRole('button', { name: COPY.moreActions }).click();
}

test.describe('@case:EDU-DECK-04 @area:EDU @prio:P2 teacher deck flashcards CRUD', () => {
  test('creates, edits, deletes and topic-tags a flashcard in a teacher deck', async ({ page }) => {
    test.setTimeout(120_000);
    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    const groupId = tenant.group?.id;
    if (!groupId) throw new Error(`${CASE} needs the content tenant profile (org + group)`);

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // ── Prerequisite: the group-shared deck, inside this tenant ─────────────
    // Only a group teacher may share a deck with `G1`; the seeder enrols the
    // educator as a group member, so the manager promotes it first.
    await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage(\/|$)/ });
    await ensureEducatorLeadsGroup(page, tenant);

    await page.context().clearCookies();
    await loginAs(page, tenant, 'teacher', { locale: 'pl' });
    expect(new URL(page.url()).pathname, 'educator lands on /edu').toBe('/edu');

    // A retry against the same tenant starts from an empty deck screen.
    await resetDecks(page);

    const deckResponse = await page.request.post('/api/v1/flashcards/decks', {
      data: { name: DECK_NAME, visibility: 'group', groupIds: [groupId] },
    });
    expect(
      deckResponse.status(),
      `POST /api/v1/flashcards/decks → ${deckResponse.status()} ${await deckResponse.text()}`,
    ).toBe(201);
    const deck = ((await deckResponse.json()) as ApiEnvelope<DeckRow>).data;
    expect(deck.visibility, 'the prerequisite deck is shared with the group').toBe('group');
    expect(deck.groupIds).toEqual([groupId]);

    const topic = await ensureTopic(page);
    expect(topic.name).toBe(TOPIC_NAME);

    await page.goto(`/edu/flashcards/${deck.id}`);
    await expect(page).toHaveURL(new RegExp(`/edu/flashcards/${deck.id}$`));
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
    await expect(
      page.locator('[data-slot="breadcrumb"]').getByText(DECK_NAME, { exact: true }),
    ).toBeVisible();
    await expectCardsCount(page, 0);
    await expect(page.getByText(COPY.empty, { exact: true })).toBeVisible();

    // ── Step 1: „Dodaj fiszkę” → „2+2” / „4” ────────────────────────────────
    await page.getByRole('button', { name: COPY.addCard }).click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByRole('heading', { name: COPY.createTitle })).toBeVisible();

    const createFields = editorTextareas(page);
    // STU-21 adjacent: the Markdown editor renders what is typed, live.
    await createFields.front.fill('**2+2**');
    await expect(
      dialog(page).locator('strong'),
      'the editor previews bold Markdown while typing',
    ).toHaveText('2+2');
    await createFields.front.fill(CARD.front);
    await expect(
      dialog(page).locator('strong'),
      'the preview follows the plain-text value again',
    ).toHaveCount(0);

    await createFields.back.fill(CARD.back);
    await dialog(page).getByRole('button', { name: COPY.create }).click();

    await expect(page.getByText(COPY.created, { exact: true })).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
    await expectCardsCount(page, 1);

    const [created] = await listCards(page, deck.id);
    expect(created, 'the card is stored in the teacher deck').toBeTruthy();
    expect({ front: created!.front, back: created!.back }).toEqual(CARD);

    const card = cardById(page, created!.id);
    await expect(card).toBeVisible();
    await expect(card).toContainText(CARD.front);
    await expect(card).toContainText(CARD.back);

    // ── Step 2a: edit it ────────────────────────────────────────────────────
    await openCardMenu(page, card);
    await page.getByRole('menuitem', { name: COPY.menuEdit }).click();

    await expect(dialog(page).getByRole('heading', { name: COPY.editTitle })).toBeVisible();
    const editFields = editorTextareas(page);
    await expect(editFields.front).toHaveValue(CARD.front);
    await expect(editFields.back).toHaveValue(CARD.back);

    await editFields.front.fill(EDITED.front);
    await editFields.back.fill(EDITED.back);
    await dialog(page).getByRole('button', { name: COPY.update }).click();

    await expect(page.getByText(COPY.updated, { exact: true })).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
    await expect(card).toContainText(EDITED.front);
    await expect(card).toContainText(EDITED.back);

    const [updated] = await listCards(page, deck.id);
    expect(updated!.id, 'the edit keeps the same card').toBe(created!.id);
    expect({ front: updated!.front, back: updated!.back }).toEqual(EDITED);

    // ── Step 2b: delete it ─────────────────────────────────────────────────
    await openCardMenu(page, card);
    await page.getByRole('menuitem', { name: COPY.menuDelete }).click();

    await expect(dialog(page).getByRole('heading', { name: COPY.deleteTitle })).toBeVisible();
    await expect(dialog(page).getByText(COPY.deleteDescription, { exact: true })).toBeVisible();
    await dialog(page).getByRole('button', { name: COPY.confirmDelete }).click();

    await expect(page.getByText(COPY.deleted, { exact: true })).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
    await expectCardsCount(page, 0);
    await expect(page.getByText(COPY.empty, { exact: true })).toBeVisible();
    await expect(cardById(page, created!.id), 'the deleted card is gone').toHaveCount(0);
    expect(await listCards(page, deck.id), 'the deleted card is gone from the API').toEqual([]);

    // ── Step 3: create again, this time with a topic ────────────────────────
    await page.getByRole('button', { name: COPY.addCard }).click();
    await expect(dialog(page)).toBeVisible();

    const topicFields = editorTextareas(page);
    await topicFields.front.fill(TOPIC_CARD.front);
    await topicFields.back.fill(TOPIC_CARD.back);

    await dialog(page).getByRole('combobox').click();
    const topicOption = page
      .locator('[data-slot="popover-content"]')
      .getByRole('option', { name: TOPIC_NAME });
    await expect(topicOption).toBeVisible();
    await topicOption.click();
    await expect(dialog(page).getByRole('combobox')).toContainText(TOPIC_NAME);
    // The multi-select keeps its popover open after a pick; the dialog title closes
    // it without touching the rest of the form.
    await dialog(page).getByRole('heading', { name: COPY.createTitle }).click();
    await expect(page.locator('[data-slot="popover-content"]')).toHaveCount(0);

    await dialog(page).getByRole('button', { name: COPY.create }).click();
    await expect(page.getByText(COPY.created, { exact: true })).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
    await expectCardsCount(page, 1);

    const [tagged] = await listCards(page, deck.id);
    expect(
      tagged!.flashcard_topic_assignments.map((assignment) => assignment.topic_id),
      'the topic is assigned to the card',
    ).toEqual([topic.id]);

    const taggedCard = cardById(page, tagged!.id);
    await expect(taggedCard).toBeVisible();
    await expect(taggedCard).toContainText(TOPIC_CARD.front);
    // Each card renders a mobile and a desktop copy of its chips, so pin the
    // locator to the one the current breakpoint shows.
    await expect(
      taggedCard.locator('span.rounded-full:visible', { hasText: TOPIC_NAME }),
      'the card shows its topic chip',
    ).toHaveText(TOPIC_NAME);

    // The deck's topic filter picks the new topic up.
    const topicFilter = page
      .locator('[data-slot="select-trigger"]')
      .filter({ hasText: COPY.topicFilterAll });
    await expect(topicFilter).toBeVisible();
    await topicFilter.click();
    await expect(page.getByRole('option', { name: TOPIC_NAME, exact: true })).toBeVisible();

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });
});
