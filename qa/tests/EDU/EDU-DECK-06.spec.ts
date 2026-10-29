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
 * EDU-DECK-06 — Statystyki fiszek (/edu/flashcards/stats).
 *
 * Prerequisite (reconciled with the tenant seeder): an educator whose own deck has
 * been practised by one of their students (the case's „S1 przerobił kilka fiszek”).
 * The legacy manual accounts (`teacher1@dev.local`, `student1@dev.local`, password
 * `pass`) are never used.
 *
 * Tenant: `tenantKey('qa/cases/EDU-DECK-06.md', 'EDU-DECK-06#<run>', 'qa-shared')`,
 * a fresh run suffix per independent run, every id from `tenantId(key, entity)`:
 *   - `teacher` is the organization owner with the org role `teacher` and the group
 *     role `teacher`, so it owns the deck and the cards the stats aggregate;
 *   - `student` is an org member and a `G1` member, i.e. the learner who practises
 *     the group-shared deck. The stats endpoint reads the caller's own cards
 *     (`flashcard.read` = `own` for a teacher), so the tenant's numbers cannot be
 *     influenced by another worker's tenant.
 * Nothing global is written: no admin setting, feature flag, plan, platform stat or
 * singleton row. Deck, topic, cards and practice rows are created through the
 * product API inside this tenant.
 *
 * Entry point: the case offers two routes, „z kafla Statystyki na hubie lub Zobacz
 * szczegóły fiszek”. The flashcard hub was replaced by the deck list, so the route
 * the product actually offers is `/edu/stats/results` → „Zobacz szczegóły fiszek”.
 * The spec walks that link instead of typing the URL.
 *
 * Acceptance points (walked on the shared app before writing the test):
 * 1. Empty base: the page renders „Statystyki fiszek” and the empty state
 *    „Brak danych” / „Utwórz fiszki, podziel je na talie i tematy, a następnie
 *    przypisz studentom. Statystyki pojawią się, gdy studenci zaczną powtarzać.”
 *    and no summary cards.
 * 2. Six summary cards with the case's metrics: Talie, Fiszki, Powtórki,
 *    Studenci, Skuteczność, Śr. EF — values 1 / 3 / 2 / 1 / 50% / the average EF.
 *    The „Studenci” card is labelled „Studenci, którzy ćwiczyli” since #460 (the
 *    count is practising learners, the teacher excluded); the case text predates
 *    that rename, so this is a copy note, not a defect.
 * 3. „Rozkład trudności” lists Łatwe / Średnie / Trudne / Nowe with one easy, one
 *    hard and one never-practised card (1 / 0 / 1 / 1), each row linking to its
 *    bucket page.
 * 4. „Podział na talie” one row: the deck, 3 cards, 2 practices, 50% accuracy and
 *    the deck's average EF.
 * 5. „Podział na tematy” one row for the tagged card: 1 card, 1 practice, 100%.
 * 6. „Powrót” leads back to the deck hub (`/edu/flashcards`).
 */

const CASE = 'EDU-DECK-06';
const CASE_FILE = 'qa/cases/EDU-DECK-06.md';
const PROJECT = 'qa-shared';
const RUN_SUFFIX = process.env.QA_RUN_SUFFIX ?? `${Date.now().toString(36)}-${randomTag(4)}`;

const DECK_NAME = 'EDU-DECK-06 talia';
const TOPIC_NAME = 'EDU-DECK-06 temat';
const GROUP_NAME = 'G1';

/** The case's fixture: one card per difficulty bucket the assertions use. */
const CARDS = {
  fresh: { front: 'Karta nowa', back: 'brak powtórek' },
  easy: { front: 'Karta łatwa', back: 'poprawna odpowiedź' },
  hard: { front: 'Karta trudna', back: 'błędna odpowiedź' },
} as const;

/** Polish copy from `EduFlashcardStatsPage` (pl.json). */
const COPY = {
  title: 'Statystyki fiszek',
  back: 'Powrót',
  emptyTitle: 'Brak danych',
  emptyDesc:
    'Utwórz fiszki, podziel je na talie i tematy, a następnie przypisz studentom. Statystyki pojawią się, gdy studenci zaczną powtarzać.',
  chartTitle: 'Rozkład trudności',
  deckTableTitle: 'Podział na talie',
  topicTableTitle: 'Podział na tematy',
  entryLink: 'Zobacz szczegóły fiszek',
} as const;

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

interface TeacherStats {
  summary: {
    totalDecks: number;
    totalFlashcards: number;
    totalPractices: number;
    practicingStudents: number;
    overallAccuracy: number;
    averageEasinessFactor: number;
    difficultyBreakdown: { easy: number; medium: number; hard: number; new: number };
  };
  byDeck: { deckId: string; deckName: string; flashcardCount: number; practiceCount: number }[];
  byTopic: { topicId: string; topicName: string; flashcardCount: number; practiceCount: number }[];
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
 * role `teacher`), `G1` is the default group and the student is a member of both.
 */
async function seedCaseTenant(): Promise<CaseTenant> {
  const key = tenantKey(CASE_FILE, `${CASE}#${RUN_SUFFIX}`, PROJECT);
  const { url, serviceKey } = resolveSupabase();
  const db = createSeedDb({ url, serviceKey });

  const org = { id: tenantId(key, 'org'), name: `qa-edu-deck-06-${RUN_SUFFIX}` };
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
  console.log(`EDU-DECK-06 tenant key: ${tenant.key} (org ${tenant.orgId})`);
});

/** `GET` an endpoint as the signed-in user and unwrap the response envelope. */
async function getData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.ok(), `GET ${url} → ${response.status()} ${await response.text()}`).toBe(true);
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data;
}

/** `POST` a JSON body as the signed-in user, assert the status and unwrap `data`. */
async function postData<T>(page: Page, url: string, data: unknown, status = 201): Promise<T> {
  const response = await page.request.post(url, { data });
  expect(response.status(), `POST ${url} → ${response.status()} ${await response.text()}`).toBe(
    status,
  );
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(body.success, `POST ${url} success flag`).toBe(true);
  return body.data;
}

async function teacherStats(page: Page): Promise<TeacherStats> {
  return getData<TeacherStats>(page, '/api/v1/flashcards/stats/teacher');
}

async function listDecks(page: Page): Promise<DeckRow[]> {
  return (await getData<{ items: DeckRow[] }>(page, '/api/v1/flashcards/decks?limit=100')).items;
}

async function listCards(page: Page, deckId: string): Promise<FlashcardRow[]> {
  return (
    await getData<{ items: FlashcardRow[] }>(page, `/api/v1/flashcards?deckIds=${deckId}&limit=100`)
  ).items;
}

/** The case's group deck, shared with `G1` so the student may practise its cards. */
async function ensureDeck(page: Page): Promise<DeckRow> {
  const existing = (await listDecks(page)).find((deck) => deck.name === DECK_NAME);
  if (existing) return existing;
  return postData<DeckRow>(page, '/api/v1/flashcards/decks', {
    name: DECK_NAME,
    visibility: 'group',
    groupIds: [tenant.groupId],
  });
}

async function ensureTopic(page: Page): Promise<TopicRow> {
  const { items } = await getData<{ items: TopicRow[] }>(
    page,
    '/api/v1/flashcards/topics?limit=100',
  );
  const existing = items.find((topic) => topic.name === TOPIC_NAME);
  if (existing) return existing;
  return postData<TopicRow>(page, '/api/v1/flashcards/topics', { name: TOPIC_NAME });
}

/**
 * One card of the fixture. `topic` tags the card when it is created; an already
 * created card without the tag (a re-run) is updated so the topic table keeps one
 * countable card.
 */
async function ensureCard(
  page: Page,
  deckId: string,
  card: { front: string; back: string },
  topic?: TopicRow,
): Promise<FlashcardRow> {
  const existing = (await listCards(page, deckId)).find((row) => row.front === card.front);
  if (existing) {
    if (topic && !existing.flashcard_topic_assignments.some((a) => a.topic_id === topic.id)) {
      const response = await page.request.put(`/api/v1/flashcards/${existing.id}`, {
        data: { topicIds: [topic.id] },
      });
      expect(
        response.ok(),
        `PUT /api/v1/flashcards/${existing.id} → ${response.status()} ${await response.text()}`,
      ).toBe(true);
    }
    return existing;
  }
  return postData<FlashcardRow>(page, '/api/v1/flashcards', {
    deckId,
    front: card.front,
    back: card.back,
    ...(topic ? { topicIds: [topic.id] } : {}),
  });
}

/**
 * The student practises the deck: one correct answer on the easy card, one wrong
 * answer on the hard card. The `new` bucket lists the cards without any practice,
 * so a re-run only logs the answer a card is still missing (idempotent).
 */
async function logStudentPractice(page: Page, cards: Record<'easy' | 'hard', FlashcardRow>) {
  const unpracticed = await getData<{ id: string }[]>(
    page,
    '/api/v1/flashcards/stats/teacher/difficulty/new',
  );
  const untouched = new Set(unpracticed.map((card) => card.id));

  await page.context().clearCookies();
  await loginAs(page, tenant.tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });

  for (const [key, wasCorrect] of [
    ['easy', true],
    ['hard', false],
  ] as const) {
    if (!untouched.has(cards[key].id)) continue;
    await postData(page, `/api/v1/flashcards/${cards[key].id}/practice`, { wasCorrect }, 201);
  }

  await page.context().clearCookies();
  await loginAs(page, tenant.tenant, 'teacher', { locale: 'pl' });
}

/** The summary card whose title the page renders (its value is the `text-3xl` line). */
function statCard(page: Page, title: string): Locator {
  return page
    .locator('main div.rounded-xl:has(p.text-3xl)')
    .filter({ has: page.getByText(title, { exact: true }) });
}

/** Assert one summary card renders exactly the given title and value. */
async function expectStat(page: Page, title: string, value: string): Promise<void> {
  const card = statCard(page, title);
  await expect(card, `summary card "${title}"`).toHaveCount(1);
  await expect(card.getByText(title, { exact: true })).toBeVisible();
  await expect(card.locator('p.text-3xl')).toHaveText(value);
}

/** One row of the difficulty chart (a link to the bucket page). */
function difficultyRow(page: Page, bucket: string): Locator {
  return page.locator(`a[href="/edu/flashcards/stats/difficulty/${bucket}"]`);
}

/** The table whose header starts with the given column label. */
function statsTable(page: Page, title: string, firstColumn: string): Locator {
  return page
    .locator('div.rounded-xl:has(table)')
    .filter({ has: page.getByText(title, { exact: true }) })
    .filter({ has: page.getByRole('columnheader', { name: firstColumn, exact: true }) });
}

/** The card's cells, trimmed (the practice cell nests a bar and a counter). */
async function cells(row: Locator): Promise<string[]> {
  return (await row.locator('td').allInnerTexts()).map((cell) => cell.replace(/\s+/g, ' ').trim());
}

test.describe('@case:EDU-DECK-06 @area:EDU @prio:P2 educator flashcard statistics', () => {
  test('shows the empty state, then the summary, difficulty and per-deck/topic splits', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await loginAs(page, tenant.tenant, 'teacher', { locale: 'pl' });
    expect(new URL(page.url()).pathname, 'educator lands on /edu').toBe('/edu');

    // ── Step 1: entry from the results page, before any activity ────────────
    await page.goto('/edu/stats/results');
    await page.getByRole('link', { name: COPY.entryLink, exact: true }).click();
    await expect(page).toHaveURL(/\/edu\/flashcards\/stats$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

    await expect(page.getByRole('heading', { level: 2, name: COPY.title })).toBeVisible();
    await expect(
      page.locator('[data-slot="breadcrumb"]').getByText(COPY.title, { exact: true }),
    ).toBeVisible();

    // Empty base: the case's „Brak danych – Utwórz fiszki…” copy, and no cards.
    await expect(page.getByText(COPY.emptyTitle, { exact: true })).toBeVisible();
    await expect(page.getByText(COPY.emptyDesc, { exact: true })).toBeVisible();
    await expect(
      page.locator('main div.rounded-xl:has(p.text-3xl)'),
      'an organization without flashcards renders no summary cards',
    ).toHaveCount(0);

    // ── Prerequisite: the teacher's deck, the tagged card, student activity ──
    const deck = await ensureDeck(page);
    expect(deck.visibility, 'the deck is shared with the tenant group').toBe('group');
    expect(deck.groupIds, 'the deck is shared with G1').toEqual([tenant.groupId]);

    const topic = await ensureTopic(page);
    await ensureCard(page, deck.id, CARDS.fresh);
    const easy = await ensureCard(page, deck.id, CARDS.easy, topic);
    const hard = await ensureCard(page, deck.id, CARDS.hard);

    await logStudentPractice(page, { easy, hard });

    // ── Step 2: the same entry link, now with a practised deck ──────────────
    await page.goto('/edu/stats/results');
    await page.getByRole('link', { name: COPY.entryLink, exact: true }).click();
    await expect(page).toHaveURL(/\/edu\/flashcards\/stats$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
    await expect(page.getByRole('heading', { level: 2, name: COPY.title })).toBeVisible();
    await expect(page.getByText(COPY.emptyTitle, { exact: true })).toHaveCount(0);

    // The six summary cards of the case, fed by this tenant's own activity.
    const stats = await teacherStats(page);
    expect(stats.summary, 'the fixture is one deck, three cards, two practices').toMatchObject({
      totalDecks: 1,
      totalFlashcards: 3,
      totalPractices: 2,
      practicingStudents: 1,
      overallAccuracy: 50,
    });

    const ef = stats.summary.averageEasinessFactor.toFixed(2);
    expect(Number(ef), 'the practised cards carry an easiness factor').toBeGreaterThan(0);

    await expect(
      page.locator('main div.rounded-xl:has(p.text-3xl)'),
      'exactly the six summary cards',
    ).toHaveCount(6);
    // „Studenci” in the case text is „Studenci, którzy ćwiczyli” since #460.
    await expectStat(page, 'Talie', '1');
    await expectStat(page, 'Fiszki', '3');
    await expectStat(page, 'Powtórki', '2');
    await expectStat(page, 'Studenci, którzy ćwiczyli', '1');
    await expectStat(page, 'Skuteczność', '50%');
    await expectStat(page, 'Śr. EF', ef);

    // ── Step 3: the difficulty chart ────────────────────────────────────────
    const chart = page
      .locator('div.rounded-xl')
      .filter({ has: page.getByText(COPY.chartTitle, { exact: true }) });
    await expect(chart).toBeVisible();
    await expect(chart.locator('a[href^="/edu/flashcards/stats/difficulty/"]')).toHaveCount(4);

    const buckets = [
      { key: 'easy', label: 'Łatwe', count: '1' },
      { key: 'medium', label: 'Średnie', count: '0' },
      { key: 'hard', label: 'Trudne', count: '1' },
      { key: 'new', label: 'Nowe', count: '1' },
    ] as const;
    for (const bucket of buckets) {
      const row = difficultyRow(page, bucket.key);
      await expect(row, `difficulty row "${bucket.label}"`).toBeVisible();
      // The label and the counter are adjacent spans, so `textContent` has no space.
      await expect(row).toHaveText(new RegExp(`${bucket.label}\\s*${bucket.count}`));
    }

    // ── Step 4: „Podział na talie” ──────────────────────────────────────────
    const deckTable = statsTable(page, COPY.deckTableTitle, 'Talia');
    await expect(deckTable).toBeVisible();
    const deckRow = deckTable.locator('tbody tr').filter({ hasText: DECK_NAME });
    await expect(deckRow, 'one row for the tenant deck').toHaveCount(1);
    const deckCells = await cells(deckRow);
    expect(deckCells).toEqual([DECK_NAME, '3', '2', '50%', ef]);
    await expect(deckRow.getByRole('link', { name: DECK_NAME, exact: true })).toHaveAttribute(
      'href',
      `/edu/flashcards/${deck.id}`,
    );

    // ── Step 5: „Podział na tematy” ─────────────────────────────────────────
    const topicTable = statsTable(page, COPY.topicTableTitle, 'Temat');
    await expect(topicTable).toBeVisible();
    const topicRow = topicTable.locator('tbody tr').filter({ hasText: TOPIC_NAME });
    await expect(topicRow, 'one row for the tagged card').toHaveCount(1);
    expect(await cells(topicRow)).toEqual([TOPIC_NAME, '1', '1', '100%']);

    // ── Step 6: „Powrót” returns to the deck hub ────────────────────────────
    await page.getByRole('link', { name: COPY.back, exact: true }).click();
    await expect(page).toHaveURL(/\/edu\/flashcards$/);

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });
});
