import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * EDU-DECK-06 — Statystyki fiszek (/edu/flashcards/stats).
 *
 * Prerequisite (reconciled with the tenant seeder): an educator whose own deck has
 * been practised by one of their students (the case's „S1 przerobił kilka fiszek”).
 * The legacy manual accounts (`teacher1@dev.local`, `student1@dev.local`, password
 * `pass`) are never used.
 *
 * Tenant: the `content` profile, seeded once before Playwright starts
 * (`bun scripts/qa-tenant.ts EDU-DECK-06 --fresh`) and read through
 * `loadTenant(CASE)` — the spec never seeds at runtime:
 *   - `teacher` is the organization's educator and a member of the default group
 *     `G1`; only a group *teacher* may share a deck with a group, so the spec
 *     promotes it through the manager's own group-roster endpoint first (the same
 *     write `/manage/groups` performs, tenant-local and idempotent). Because the
 *     seeded org role is `member`, `flashcard.read` resolves to the group scope —
 *     the tenant holds only this educator's own cards, and no other worker's tenant
 *     shares its organization or groups, so the numbers stay local;
 *   - `student` is an org member and a `G1` member, i.e. the learner who practises
 *     the group-shared deck.
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

const DECK_NAME = 'EDU-DECK-06 talia';
const TOPIC_NAME = 'EDU-DECK-06 temat';

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
 * deck a previous run left behind (its cards and topic links go with it) so the
 * „Brak danych” base is real again. Only this case's own deck is touched.
 */
async function resetDeck(page: Page): Promise<void> {
  for (const deck of (await listDecks(page)).filter((row) => row.name === DECK_NAME)) {
    const response = await page.request.delete(`/api/v1/flashcards/decks/${deck.id}`);
    expect(response.ok(), `DELETE /api/v1/flashcards/decks/${deck.id} → ${response.status()}`).toBe(
      true,
    );
  }
}

/** The case's group deck, shared with `G1` so the student may practise its cards. */
async function ensureDeck(page: Page, tenant: QaTenant): Promise<DeckRow> {
  const existing = (await listDecks(page)).find((deck) => deck.name === DECK_NAME);
  if (existing) return existing;
  return postData<DeckRow>(page, '/api/v1/flashcards/decks', {
    name: DECK_NAME,
    visibility: 'group',
    groupIds: [tenant.group!.id],
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
async function logStudentPractice(
  page: Page,
  tenant: QaTenant,
  cards: Record<'easy' | 'hard', FlashcardRow>,
) {
  const unpracticed = await getData<{ id: string }[]>(
    page,
    '/api/v1/flashcards/stats/teacher/difficulty/new',
  );
  const untouched = new Set(unpracticed.map((card) => card.id));

  await page.context().clearCookies();
  await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });

  for (const [key, wasCorrect] of [
    ['easy', true],
    ['hard', false],
  ] as const) {
    if (!untouched.has(cards[key].id)) continue;
    await postData(page, `/api/v1/flashcards/${cards[key].id}/practice`, { wasCorrect }, 201);
  }

  await page.context().clearCookies();
  await loginAs(page, tenant, 'teacher', { locale: 'pl' });
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
    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    const groupId = tenant.group?.id;
    if (!groupId) throw new Error(`${CASE} needs the content tenant profile (org + group)`);

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // Only a group teacher may share a deck with `G1`; the seeder enrols the
    // educator as a group member, so the manager promotes it first.
    await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage(\/|$)/ });
    await ensureEducatorLeadsGroup(page, tenant);

    await page.context().clearCookies();
    await loginAs(page, tenant, 'teacher', { locale: 'pl' });
    expect(new URL(page.url()).pathname, 'educator lands on /edu').toBe('/edu');

    // A retry against the same tenant starts from the empty base again.
    await resetDeck(page);

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
    const deck = await ensureDeck(page, tenant);
    expect(deck.visibility, 'the deck is shared with the tenant group').toBe('group');
    expect(deck.groupIds, 'the deck is shared with G1').toEqual([groupId]);

    const topic = await ensureTopic(page);
    await ensureCard(page, deck.id, CARDS.fresh);
    const easy = await ensureCard(page, deck.id, CARDS.easy, topic);
    const hard = await ensureCard(page, deck.id, CARDS.hard);

    await logStudentPractice(page, tenant, { easy, hard });

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
