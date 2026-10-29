import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';
import { tenantKey } from '#test/e2e/fixtures/ids';
import {
  buildAccount,
  createSeedDb,
  randomTag,
  seedTenantGraph,
  tenantId,
} from '#test/helpers/tenant-seed';

/**
 * EDU-DECK-04 — Fiszki w talii nauczyciela (/edu/flashcards/<deckId>).
 *
 * Prerequisite (reconciled with the tenant seeder): EDU-DECK-02 has already left a
 * group deck named „Matematyka – klasa 1” shared to the tenant group `G1`, owned by
 * the organization's teacher. The case's legacy accounts (`teacher1@dev.local`,
 * password `pass`) are never used.
 *
 * Tenant: `tenantKey('qa/cases/EDU-DECK-04.md', 'EDU-DECK-04#<run>', 'qa-shared')`,
 * fresh run suffix per independent run, every id from `tenantId(key, entity)`:
 *   - the teacher is the org owner with the org role `teacher` and the group role
 *     `teacher`, so it may both own the deck and share it with `G1` (the same shape
 *     EDU-DECK-02 uses);
 *   - the student is an org member and a `G1` member (the group the deck is shared
 *     with) — a prerequisite, not a subject of this case.
 * Nothing global is written: no admin setting, feature flag, plan, platform stat or
 * singleton row. The deck and the topic are created through the product API inside
 * this tenant.
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
const CASE_FILE = 'qa/cases/EDU-DECK-04.md';
const PROJECT = 'qa-shared';
const RUN_SUFFIX = process.env.QA_RUN_SUFFIX ?? `${Date.now().toString(36)}-${randomTag(4)}`;

const DECK_NAME = 'Matematyka – klasa 1';
const GROUP_NAME = 'G1';
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

/** Supabase local defaults (the service-role JWT is the `supabase start` demo key). */
const LOCAL_SUPABASE_URL = 'http://localhost:54421';
const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

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

interface CaseTenant {
  key: string;
  tenant: QaTenant;
  orgId: string;
  groupId: string;
}

function resolveSupabase(): { url: string; serviceKey: string } {
  let fromEnvJson: string | undefined;
  try {
    const raw = readFileSync(join(process.cwd(), 'qa', 'env.json'), 'utf8');
    fromEnvJson = (JSON.parse(raw) as { supabaseUrl?: string }).supabaseUrl;
  } catch {
    // qa/env.json is worker-local and gitignored; absence is fine.
  }

  return {
    url:
      process.env.QA_SUPABASE_URL ??
      process.env.NEXT_PUBLIC_SUPABASE_URL ??
      fromEnvJson ??
      LOCAL_SUPABASE_URL,
    serviceKey:
      process.env.QA_SUPABASE_SERVICE_ROLE_KEY ??
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      LOCAL_SERVICE_ROLE_KEY,
  };
}

/**
 * Seed the case's own organization: the teacher owns it (org role `teacher`, group
 * role `teacher`), the group `G1` is the organization's default group and the
 * student is a member of both — the prerequisite EDU-DECK-02 leaves behind.
 */
async function seedCaseTenant(): Promise<CaseTenant> {
  const key = tenantKey(CASE_FILE, `${CASE}#${RUN_SUFFIX}`, PROJECT);
  const { url, serviceKey } = resolveSupabase();
  const db = createSeedDb({ url, serviceKey });

  const org = { id: tenantId(key, 'org'), name: `qa-edu-deck-04-${RUN_SUFFIX}` };
  const group = { id: tenantId(key, 'group:default'), name: GROUP_NAME };
  const teacher = buildAccount(key, 'teacher', 'educator', {
    name: 'QA teacher',
    orgRole: 'teacher',
  });
  const student = buildAccount(key, 'student', 'student', { name: 'QA student' });

  const seeded = await seedTenantGraph(db, {
    key,
    org,
    defaultGroup: { ...group, isDefault: true },
    extraGroups: [],
    owner: teacher,
    members: [student],
    ownerOrgRole: 'teacher',
  });

  const account = (user: { id: string; email: string; password: string }) => ({
    id: user.id,
    email: user.email,
    password: user.password,
  });

  return {
    key,
    orgId: seeded.orgId!,
    groupId: seeded.defaultGroupId!,
    tenant: {
      case: CASE,
      key,
      profile: 'content',
      runSuffix: RUN_SUFFIX,
      org,
      group,
      users: {
        teacher: account(seeded.owner),
        student: account(seeded.members[0]),
      },
    },
  };
}

let tenant: CaseTenant;

test.beforeAll(async () => {
  tenant = await seedCaseTenant();
  console.log(`EDU-DECK-04 tenant key: ${tenant.key} (org ${tenant.orgId})`);
});

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
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // ── Prerequisite: EDU-DECK-02's group deck, inside this tenant ──────────
    await loginAs(page, tenant.tenant, 'teacher', { locale: 'pl' });
    expect(new URL(page.url()).pathname, 'educator lands on /edu').toBe('/edu');

    const deckResponse = await page.request.post('/api/v1/flashcards/decks', {
      data: { name: DECK_NAME, visibility: 'group', groupIds: [tenant.groupId] },
    });
    expect(
      deckResponse.status(),
      `POST /api/v1/flashcards/decks → ${deckResponse.status()} ${await deckResponse.text()}`,
    ).toBe(201);
    const deck = ((await deckResponse.json()) as ApiEnvelope<DeckRow>).data;
    expect(deck.visibility, 'the prerequisite deck is shared with the group').toBe('group');
    expect(deck.groupIds).toEqual([tenant.groupId]);

    const topicResponse = await page.request.post('/api/v1/flashcards/topics', {
      data: { name: TOPIC_NAME },
    });
    expect(
      topicResponse.status(),
      `POST /api/v1/flashcards/topics → ${topicResponse.status()} ${await topicResponse.text()}`,
    ).toBe(201);
    const topic = ((await topicResponse.json()) as ApiEnvelope<TopicRow>).data;
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
