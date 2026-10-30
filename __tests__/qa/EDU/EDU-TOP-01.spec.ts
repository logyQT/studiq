import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * EDU-TOP-01 — the educator's topics (`/edu/topics`): CRUD, flashcard counter and
 * the scope/group filters.
 *
 * Case steps: open `/edu/topics`, create the topic „Algebra”, rename it, delete it,
 * then check the scope filter („Wszystkie” / „Moje”) and the group filter
 * („Dowolna grupa” / „Moje grupy”).
 *
 * Tenant (deterministic, `content` profile, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts EDU-TOP-01 --fresh
 *
 * gives the org `qa-edu-top-01-<suffix>` with a manager, an educator and a student,
 * plus the default group `G1` (`tenantKey('qa/cases/EDU-TOP-01.md',
 * 'EDU-TOP-01#<suffix>', 'qa-shared')` + `tenantId(key, entity)` for every id). The
 * spec reads the ids through `loadTenant('EDU-TOP-01')`; nothing global is read or
 * written — no admin setting, feature flag, plan, platform stat or singleton row.
 *
 * The case was written against the legacy manual seed (`teacher1@dev.local`, groups
 * `O1G1`/`O2G1`, the „Algebra” topic). In the tenant model the educator is an org
 * `member`: `topic.read` is `group`, so it sees its own topics plus the ones shared
 * to `G1`. That is the minimum shape the filter step needs, and it is why the spec
 * prepares three rows through the product API before the walk:
 * - `SHARED_TOPIC` — created by the tenant manager (org `admin`) and shared to `G1`,
 *   i.e. visible under „Wszystkie” and filtered out by „Moje”;
 * - `OWN_TOPIC` — created by the educator, so „Moje” still has a row after the case's
 *   own „Algebra” topic is deleted in step 3 (the case checks the filters in step 4);
 * - the deck `DECK` holding the two flashcards the counter assertion uses.
 *
 * Every prepared row is deleted and re-created on each execution, so a CI retry on
 * the same seeded tenant (`--retries=2`) starts from the same list instead of
 * depending on an earlier run's leftovers.
 *
 * Acceptance points confirmed on the shared app during the walk (2026-10-29):
 * 1. `/edu/topics` is „Tematy fiszek” in the breadcrumb, with the „Nowy temat”
 *    button, the search field, the scope select, the group multi-select and the
 *    „Moje grupy” quick action.
 * 2. „Nowy temat” opens „Utwórz temat” / „Dodaj nowy temat fiszek” with an empty
 *    name field; submitting it shows „Nazwa tematu jest wymagana”, keeps the dialog
 *    open and creates nothing.
 * 3. Saving „Algebra” shows „Temat utworzony”, closes the dialog and adds the card
 *    with „0 fiszek”; the API stores exactly one topic with that name, owned by the
 *    educator.
 * 4. A topic with two flashcards shows the correct count („2 fiszek” on the card,
 *    „2 fiszki w tym temacie” in the preview, both flashcards listed).
 * 5. The card menu → „Edytuj” opens „Edytuj temat” with the current name; saving
 *    „Algebra liniowa” shows „Temat zaktualizowany” and the API stores the new name.
 * 6. The card menu → „Usuń” asks „Usunąć temat?”; confirming shows „Temat usunięty”,
 *    removes the card and the topic is gone from the API.
 * 7. The scope select offers exactly „Wszystkie” / „Moje” — no legacy
 *    „Udostępnione” or „Grupy” option. „Moje” keeps only the educator's own topics
 *    and „Wszystkie” brings the `G1`-shared topic back.
 * 8. The group filter is a multi-select whose placeholder is „Dowolna grupa”;
 *    „Moje grupy” selects the educator's group, leaves only the `G1` topics and
 *    disables itself, and clearing the selection restores the placeholder and the
 *    full list.
 */

const CASE = 'EDU-TOP-01';

/** Polish copy from `EduFlashcardTopicsPage` / `ScopeGroupFilter` (pl.json). */
const COPY = {
  navTopics: 'Tematy',
  title: 'Tematy fiszek',
  newTopic: 'Nowy temat',
  createTitle: 'Utwórz temat',
  createDesc: 'Dodaj nowy temat fiszek',
  editTitle: 'Edytuj temat',
  editDesc: 'Zaktualizuj nazwę tematu',
  create: 'Utwórz',
  update: 'Aktualizuj',
  remove: 'Usuń',
  edit: 'Edytuj',
  close: 'Zamknij',
  nameRequired: 'Nazwa tematu jest wymagana',
  created: 'Temat utworzony',
  updated: 'Temat zaktualizowany',
  deleted: 'Temat usunięty',
  deleteTitle: 'Usunąć temat?',
  deleteDesc: 'To trwale usunie temat. Tej akcji nie można cofnąć.',
  ownerAll: 'Wszystkie',
  ownerMine: 'Moje',
  groupAny: 'Dowolna grupa',
  groupMine: 'Moje grupy',
  viewFlashcards: 'Przeglądaj fiszki',
} as const;

/** The case's own topic, its renamed form, and the two prepared rows. */
const TOPIC = 'Algebra';
const RENAMED = 'Algebra liniowa';
const OWN_TOPIC = 'EDU-TOP-01 własny';
const SHARED_TOPIC = 'EDU-TOP-01 wspólny';
const DECK = 'EDU-TOP-01 talia';
const CARD_FRONTS = ['Pytanie 1', 'Pytanie 2'] as const;

const TOPICS_URL = '/api/v1/flashcards/topics';
const DECKS_URL = '/api/v1/flashcards/decks';
const FLASHCARDS_URL = '/api/v1/flashcards';

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: string;
}

interface TopicRow {
  id: string;
  name: string;
  created_by: string;
  visibility: 'personal' | 'group';
  flashcard_count: number;
}

interface DeckRow {
  id: string;
  name: string;
}

interface FlashcardRow {
  id: string;
  front: string;
  back: string;
}

/** `GET` an endpoint as the signed-in user and unwrap the response envelope. */
async function getData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.ok(), `GET ${url} → ${response.status()} ${await response.text()}`).toBe(true);
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data;
}

/** `GET /api/v1/flashcards/topics` — the same list the screen renders. */
async function listTopics(page: Page, query = ''): Promise<TopicRow[]> {
  const data = await getData<{ items: TopicRow[] }>(page, `${TOPICS_URL}?limit=50${query}`);
  return data.items;
}

/** Delete every topic with this exact name, so the next assertion starts clean. */
async function deleteTopicsNamed(page: Page, name: string): Promise<void> {
  for (const topic of (await listTopics(page)).filter((row) => row.name === name)) {
    const response = await page.request.delete(`${TOPICS_URL}/${topic.id}`);
    expect(
      response.status(),
      `DELETE ${TOPICS_URL}/${topic.id} (${name}) → ${await response.text()}`,
    ).toBe(200);
  }
}

/** Create a topic through the product API (the case's own creation goes through the UI). */
async function createTopic(
  page: Page,
  data: { name: string; visibility: 'personal' | 'group'; groupIds?: string[] },
): Promise<TopicRow> {
  const response = await page.request.post(TOPICS_URL, { data });
  expect(
    response.status(),
    `POST ${TOPICS_URL} (${data.name}) → ${response.status()} ${await response.text()}`,
  ).toBe(201);
  const body = (await response.json()) as ApiEnvelope<TopicRow>;
  expect(body.success, `POST ${TOPICS_URL} (${data.name}) success flag`).toBe(true);
  return body.data;
}

/** The tenant deck that holds the flashcards the counter assertion counts. */
async function ensureDeck(page: Page, name: string): Promise<DeckRow> {
  const existing = (
    await getData<{ items: DeckRow[] }>(
      page,
      `${DECKS_URL}?sortBy=created_at&sortOrder=desc&limit=100`,
    )
  ).items.find((deck) => deck.name === name);
  if (existing) return existing;

  const response = await page.request.post(DECKS_URL, { data: { name, visibility: 'personal' } });
  expect(
    response.status(),
    `POST ${DECKS_URL} (${name}) → ${response.status()} ${await response.text()}`,
  ).toBe(201);
  const body = (await response.json()) as ApiEnvelope<DeckRow>;
  expect(body.success, `POST ${DECKS_URL} (${name}) success flag`).toBe(true);
  return body.data;
}

/** Empty the deck, so the topic's counter is exactly `CARD_FRONTS.length`. */
async function resetDeck(page: Page, deckId: string): Promise<void> {
  const cards = (
    await getData<{ items: FlashcardRow[] }>(page, `${FLASHCARDS_URL}?deckIds=${deckId}&limit=100`)
  ).items;
  if (cards.length === 0) return;

  const response = await page.request.post(`${FLASHCARDS_URL}/batch/delete`, {
    data: { ids: cards.map((card) => card.id) },
  });
  expect(
    response.status(),
    `POST ${FLASHCARDS_URL}/batch/delete → ${response.status()} ${await response.text()}`,
  ).toBe(200);
}

/** Create one flashcard of the deck, assigned to the case's topic. */
async function createFlashcard(
  page: Page,
  data: { deckId: string; front: string; back: string; topicIds: string[] },
): Promise<void> {
  const response = await page.request.post(FLASHCARDS_URL, { data });
  expect(
    response.status(),
    `POST ${FLASHCARDS_URL} (${data.front}) → ${response.status()} ${await response.text()}`,
  ).toBe(201);
}

/** The card of the topic with this exact name (the title is the card's `h3`). */
function topicCard(page: Page, name: string): Locator {
  return page.locator('[data-slot="card"]').filter({
    has: page.getByRole('heading', { name, exact: true }),
  });
}

/** The card's „Więcej akcji: <name>” trigger (the mobile duplicate is `display:none`). */
function moreActions(page: Page, name: string): Locator {
  return topicCard(page, name).getByRole('button', { name: `Więcej akcji: ${name}` });
}

/** The dialog surface shared by the create/edit form and the delete confirmation. */
function dialog(page: Page): Locator {
  return page.locator('[data-slot="dialog-content"]');
}

test.describe('@case:EDU-TOP-01 @area:EDU @prio:P2 educator topics CRUD and filters', () => {
  test('creates, renames and deletes „Algebra”, counts its flashcards and filters the list', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const tenant: QaTenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    const group = tenant.group;
    const educator = tenant.users.teacher;
    if (!group || !educator) {
      throw new Error(`${CASE} needs the content tenant profile (org, group and educator)`);
    }

    // ── Tenant prep ─────────────────────────────────────────────────────────
    // Manager session: the `G1`-shared topic the filter step needs. Deleting a
    // leftover first keeps the list deterministic on a CI retry.
    await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage(\/|$)/ });
    await deleteTopicsNamed(page, SHARED_TOPIC);
    await createTopic(page, {
      name: SHARED_TOPIC,
      visibility: 'group',
      groupIds: [group.id],
    });

    // Educator session: its own leftovers, the deck and the topic „Moje” keeps
    // after the case's topic is deleted.
    await page.context().clearCookies();
    await loginAs(page, tenant, 'teacher', { locale: 'pl' });
    expect(new URL(page.url()).pathname, 'educator lands on /edu').toBe('/edu');

    for (const name of [TOPIC, RENAMED, OWN_TOPIC]) {
      await deleteTopicsNamed(page, name);
    }
    const deck = await ensureDeck(page, DECK);
    await resetDeck(page, deck.id);
    await createTopic(page, { name: OWN_TOPIC, visibility: 'personal' });

    // ── Step 1: the educator's topic page ───────────────────────────────────
    const sidebar = page.locator('[data-slot="sidebar"]');
    await page.goto('/edu/topics');
    await expect(page).toHaveURL(/\/edu\/topics$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
    await expect(
      sidebar.getByRole('link', { name: COPY.navTopics, exact: true }),
      'the „Tematy” sidebar entry',
    ).toBeVisible();
    await expect(
      page.locator('[data-slot="breadcrumb"]').getByText(COPY.title, { exact: true }),
      'the page breadcrumb',
    ).toBeVisible();
    await expect(page.getByRole('button', { name: COPY.newTopic }).first()).toBeVisible();

    // ── Step 2: create „Algebra” ────────────────────────────────────────────
    await page.getByRole('button', { name: COPY.newTopic }).first().click();
    const form = dialog(page);
    await expect(form).toBeVisible();
    await expect(form.getByRole('heading', { name: COPY.createTitle })).toBeVisible();
    await expect(form.getByText(COPY.createDesc, { exact: true })).toBeVisible();
    const nameInput = form.getByRole('textbox');
    await expect(nameInput, 'a new topic starts with an empty name').toHaveValue('');

    // An empty name is refused client-side: toast, dialog stays, nothing stored.
    await form.getByRole('button', { name: COPY.create, exact: true }).click();
    await expect(page.getByText(COPY.nameRequired, { exact: true })).toBeVisible();
    await expect(form, 'the dialog stays open after the validation error').toBeVisible();
    expect(
      (await listTopics(page)).filter((topic) => topic.name === TOPIC),
      'no topic was created by the empty submit',
    ).toHaveLength(0);

    await nameInput.fill(TOPIC);
    await form.getByRole('button', { name: COPY.create, exact: true }).click();
    await expect(page.getByText(COPY.created, { exact: true })).toBeVisible();
    await expect(form).toBeHidden();

    const createdCard = topicCard(page, TOPIC);
    await expect(createdCard, 'the new topic is listed').toBeVisible();
    await expect(
      createdCard.locator('[data-slot="badge"]').first(),
      'a new topic has no flashcards',
    ).toHaveText(/^0\s+fisz/);

    const stored = (await listTopics(page)).filter((topic) => topic.name === TOPIC);
    expect(stored, 'exactly one „Algebra” in the API').toHaveLength(1);
    expect(stored[0].created_by, 'the educator owns the topic').toBe(educator.id);
    expect(stored[0].flashcard_count).toBe(0);

    // ── Acceptance: the flashcard counter ───────────────────────────────────
    for (const [index, front] of CARD_FRONTS.entries()) {
      await createFlashcard(page, {
        deckId: deck.id,
        front,
        back: `Odpowiedź ${index + 1}`,
        topicIds: [stored[0].id],
      });
    }

    await page.reload();
    const countedCard = topicCard(page, TOPIC);
    await expect(
      countedCard.locator('[data-slot="badge"]').first(),
      'the card shows the topic’s two flashcards',
    ).toHaveText(/^2\s+fisz/);
    expect(
      (await listTopics(page)).find((topic) => topic.name === TOPIC)?.flashcard_count,
      'the API counts two flashcards',
    ).toBe(2);

    await countedCard.getByRole('button', { name: COPY.viewFlashcards }).click();
    const preview = dialog(page);
    await expect(preview.getByRole('heading', { name: TOPIC })).toBeVisible();
    await expect(
      preview.getByText('2 fiszki w tym temacie', { exact: true }),
      'the preview repeats the same count',
    ).toBeVisible();
    for (const front of CARD_FRONTS) {
      await expect(preview.getByText(front, { exact: true })).toBeVisible();
    }
    await preview.getByRole('button', { name: COPY.close, exact: true }).click();
    await expect(preview).toBeHidden();

    // ── Step 3a: rename ─────────────────────────────────────────────────────
    await moreActions(page, TOPIC).click();
    await page.getByRole('menuitem', { name: COPY.edit, exact: true }).click();
    await expect(form).toBeVisible();
    await expect(form.getByRole('heading', { name: COPY.editTitle })).toBeVisible();
    await expect(form.getByText(COPY.editDesc, { exact: true })).toBeVisible();
    await expect(nameInput, 'the edit form starts from the current name').toHaveValue(TOPIC);

    await nameInput.fill(RENAMED);
    await form.getByRole('button', { name: COPY.update, exact: true }).click();
    await expect(page.getByText(COPY.updated, { exact: true })).toBeVisible();
    await expect(form).toBeHidden();
    await expect(topicCard(page, RENAMED), 'the card carries the new name').toBeVisible();
    await expect(topicCard(page, TOPIC), 'the old name is gone').toHaveCount(0);

    const renamed = (await listTopics(page)).filter((topic) => topic.name === RENAMED);
    expect(renamed, 'the API stores the renamed topic').toHaveLength(1);
    expect(renamed[0].id).toBe(stored[0].id);
    expect(renamed[0].flashcard_count, 'the rename keeps the flashcards').toBe(2);

    // ── Step 3b: delete ─────────────────────────────────────────────────────
    await moreActions(page, RENAMED).click();
    await page.getByRole('menuitem', { name: COPY.remove, exact: true }).click();
    const confirm = dialog(page);
    await expect(confirm.getByRole('heading', { name: COPY.deleteTitle })).toBeVisible();
    await expect(confirm.getByText(COPY.deleteDesc, { exact: true })).toBeVisible();
    await confirm.getByRole('button', { name: COPY.remove, exact: true }).click();

    await expect(page.getByText(COPY.deleted, { exact: true })).toBeVisible();
    await expect(confirm).toBeHidden();
    await expect(topicCard(page, RENAMED), 'the deleted topic leaves the list').toHaveCount(0);
    expect(
      (await listTopics(page)).map((topic) => topic.name),
      'the API no longer returns the deleted topic',
    ).not.toContain(RENAMED);

    // ── Step 4a: the scope filter ───────────────────────────────────────────
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
    await expect(topicCard(page, OWN_TOPIC), 'the educator’s own topic').toBeVisible();
    await expect(topicCard(page, SHARED_TOPIC), 'the G1-shared topic').toBeVisible();

    // Radix `Select` triggers expose their value as the control's text, not its
    // accessible name, so the scope select is the one quoting „Wszystkie”.
    const scopeSelect = page
      .locator('[data-slot="select-trigger"]')
      .filter({ hasText: COPY.ownerAll });
    await expect(scopeSelect).toBeVisible();
    await scopeSelect.click();

    const scopeOptions = page.getByRole('option');
    await expect(scopeOptions, 'the scope select has exactly two options').toHaveCount(2);
    await expect(scopeOptions.nth(0)).toHaveText(COPY.ownerAll);
    await expect(scopeOptions.nth(1)).toHaveText(COPY.ownerMine);
    // The retired toggles must not come back as extra scope options.
    await expect(page.getByRole('option', { name: 'Udostępnione', exact: true })).toHaveCount(0);
    await expect(page.getByRole('option', { name: 'Grupy', exact: true })).toHaveCount(0);

    const mineRequest = page.waitForRequest((request) => {
      if (!request.url().includes(`${TOPICS_URL}?`)) return false;
      return new URL(request.url()).searchParams.get('owner') === 'mine';
    });
    await page.getByRole('option', { name: COPY.ownerMine, exact: true }).click();
    await mineRequest;

    await expect(topicCard(page, OWN_TOPIC)).toBeVisible();
    await expect(topicCard(page, SHARED_TOPIC), 'not the educator’s topic').toHaveCount(0);
    expect(
      (await listTopics(page, '&owner=mine')).map((topic) => topic.name),
      '„Moje” narrows the API list to the educator’s own topics',
    ).toEqual([OWN_TOPIC]);

    // Back to „Wszystkie”: the shared topic is readable again.
    await page.locator('[data-slot="select-trigger"]').filter({ hasText: COPY.ownerMine }).click();
    await page.getByRole('option', { name: COPY.ownerAll, exact: true }).click();
    await expect(topicCard(page, SHARED_TOPIC)).toBeVisible();
    await expect(topicCard(page, OWN_TOPIC)).toBeVisible();

    // ── Step 4b: the group filter ───────────────────────────────────────────
    // The group filter is the only combobox that is not a Radix `Select` trigger.
    const groupSelect = page.locator('button[role="combobox"]:not([data-slot="select-trigger"])');
    await expect(groupSelect, 'the group multi-select starts on „Dowolna grupa”').toContainText(
      COPY.groupAny,
    );
    const mineGroups = page.getByRole('button', { name: COPY.groupMine, exact: true });
    await expect(mineGroups, 'the educator belongs to the tenant group').toBeVisible();
    await expect(mineGroups).toBeEnabled();

    await mineGroups.click();
    await expect(groupSelect).toContainText(group.name);
    await expect(
      mineGroups,
      'the quick action is spent once its groups are selected',
    ).toBeDisabled();
    await expect(topicCard(page, SHARED_TOPIC), 'the G1 topic stays').toBeVisible();
    await expect(topicCard(page, OWN_TOPIC), 'personal topics are outside G1').toHaveCount(0);

    // Clearing the group selection restores the placeholder and the full list.
    await groupSelect.click();
    await page.getByRole('option', { name: group.name, exact: true }).click();
    await expect(groupSelect).toContainText(COPY.groupAny);
    await expect(mineGroups).toBeEnabled();
    await expect(topicCard(page, OWN_TOPIC)).toBeVisible();
    await expect(topicCard(page, SHARED_TOPIC)).toBeVisible();

    expect(pageErrors, 'uncaught page errors on /edu/topics').toEqual([]);
  });
});
