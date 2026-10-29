import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { createQaSupabase } from '@qa/fixtures/qa-db';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * EDU-ST-01 — the educator's „Treści” statistics (`/edu/stats/data`).
 *
 * Case steps: open `/edu/stats/data`, then change the „Wszystkie przedmioty”
 * filter.
 *
 * Tenant (deterministic `content` profile, a fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts EDU-ST-01 --fresh
 *
 * gives the org `qa-edu-st-01-<suffix>` with a manager, an educator and a student,
 * plus the default group `G1`, every id derived from
 * `tenantKey('qa/cases/EDU-ST-01.md', 'EDU-ST-01#<suffix>', 'qa-shared')` +
 * `tenantId(key, entity)`. The spec reads them through `loadTenant('EDU-ST-01')`.
 * Nothing global is read or written: no admin setting, feature flag, plan,
 * platform stat or singleton row, and no other worker's tenant.
 *
 * The case was written against the legacy Classroom seed (`teacher-classroom@dev.local`,
 * 2 banks, 10 questions, 2 decks × 4 cards, 2 topics, one student in the group).
 * In the tenant model the spec builds that shape inside its own tenant through the
 * product API, idempotently (CI seeds one tenant per spec and retries reuse it):
 * „Historia” (4 questions) + „Geografia i Nauka” (6) = 10 questions — 4 mcq,
 * 3 true/false, 3 open; „Historia – fiszki” + „Geografia – fiszki” = 2 decks with
 * 4 cards each; topics „Średniowiecze” and „Odkrycia geograficzne”.
 *
 * The seeder enrols the educator as a group `member`, and only a group `teacher`
 * may share content to the group, so the spec promotes it through the manager's own
 * roster endpoint (`PUT /api/v1/organization/groups/:id/members`, the write
 * `/manage/groups` performs) before creating the group-shared decks.
 *
 * Acceptance points (walked on the shared app, worker qa-env-6, before writing):
 * 1. The cards read „Wszystkie pytania” 10, „Wszystkie fiszki” 8, „Wszystkie
 *    talie” 2, and „Studenci” = the class size (1: the seeded student in `G1`,
 *    the educator not counted) with „Aktywnych: N” underneath.
 * 2. One practice by the student raises „Aktywnych” by 1 and fills the card's
 *    progress bar; the educator's own practice never moves it (#460).
 * 3. The question split is 4 mcq / 3 true-false / 3 open, the „według przedmiotu”
 *    split is „Geografia i Nauka” 6 / „Historia” 4, and the deck/topic tables list
 *    both decks and both topics with 4 cards each.
 * 4. Choosing „Historia” in the subject filter narrows the type split to 2/1/1
 *    while the totals and the by-subject overview stay global (the filter explains
 *    the overview; it does not rewrite it).
 * 5. „Zobacz szczegółowe statystyki pytań” opens `/edu/statistics` and „Zobacz
 *    szczegółowe statystyki fiszek” opens `/edu/flashcards/stats`, whose student
 *    card is labelled „Studenci, którzy ćwiczyli” in the unchanged 6-card grid.
 * 6. Without an active organization the stats payload reports `rosterStudents:
 *    null` (the page hides the card instead of printing 0) and switching to the
 *    tenant organization reports the real class size. The UI itself always has an
 *    active organization — `useOrgs` auto-selects the only membership and a teacher
 *    without an organization is redirected to `/setup` — so this leg is asserted on
 *    the endpoint the card renders from.
 *
 * Not covered here: switching between two organizations (the case's „przełączenie
 * organizacji” bullet). The `content` tenant has one organization, and no seeder
 * profile gives a teacher two memberships; that leg needs its own fixture.
 */

const CASE = 'EDU-ST-01';

/** Polish copy from `StatsDataPage` / `EduFlashcardStatsPage` / `Common` (pl.json). */
const COPY = {
  title: 'Treści',
  allSubjects: 'Wszystkie przedmioty',
  totalQuestions: 'Wszystkie pytania',
  totalFlashcards: 'Wszystkie fiszki',
  totalDecks: 'Wszystkie talie',
  students: 'Studenci',
  byTypeTitle: 'Pytania według typu',
  bySubjectTitle: 'Pytania według przedmiotu',
  deckTitle: 'Liczby talii',
  topicTitle: 'Liczby tematów',
  mcq: 'Wielokrotnego wyboru',
  trueFalse: 'Prawda / Fałsz',
  open: 'Otwarte',
  viewQuestionStats: 'Zobacz szczegółowe statystyki pytań',
  viewFlashcardStats: 'Zobacz szczegółowe statystyki fiszek',
  flashcardStatsTitle: 'Statystyki fiszek',
  practisingStudents: 'Studenci, którzy ćwiczyli',
  statisticsTitle: 'Statystyki',
} as const;

/** The two banks/decks/topics the case's Classroom seed is reconciled to. */
const BANKS = { historia: 'Historia', geografia: 'Geografia i Nauka' } as const;
const DECKS = {
  historia: 'Historia – fiszki',
  geografia: 'Geografia – fiszki',
} as const;
const TOPICS = {
  historia: 'Średniowiecze',
  geografia: 'Odkrycia geograficzne',
} as const;

type BankKey = keyof typeof BANKS;
type DeckKey = keyof typeof DECKS;
type TopicKey = keyof typeof TOPICS;

interface QuestionSpec {
  bank: BankKey;
  type: 'mcq' | 'true_false' | 'open';
  content: string;
  answers: Array<{ content: string; isCorrect: boolean }>;
}

/** 10 questions: 4 multiple choice, 3 true/false, 3 open (the case's seed shape). */
const QUESTIONS: QuestionSpec[] = [
  {
    bank: 'historia',
    type: 'mcq',
    content: 'Kiedy upadł Konstantynopol?',
    answers: [
      { content: '1453', isCorrect: true },
      { content: '1492', isCorrect: false },
      { content: '966', isCorrect: false },
    ],
  },
  {
    bank: 'historia',
    type: 'mcq',
    content: 'Kto był pierwszym królem Polski?',
    answers: [
      { content: 'Bolesław Chrobry', isCorrect: true },
      { content: 'Mieszko I', isCorrect: false },
      { content: 'Kazimierz Wielki', isCorrect: false },
    ],
  },
  {
    bank: 'historia',
    type: 'true_false',
    content: 'Mieszko I przyjął chrzest w 966 roku.',
    answers: [
      { content: 'Prawda', isCorrect: true },
      { content: 'Fałsz', isCorrect: false },
    ],
  },
  {
    bank: 'historia',
    type: 'open',
    content: 'Opisz skutki upadku Konstantynopola.',
    answers: [],
  },
  {
    bank: 'geografia',
    type: 'mcq',
    content: 'Kto odkrył Amerykę?',
    answers: [
      { content: 'Krzysztof Kolumb', isCorrect: true },
      { content: 'Ferdynand Magellan', isCorrect: false },
      { content: 'Vasco da Gama', isCorrect: false },
    ],
  },
  {
    bank: 'geografia',
    type: 'mcq',
    content: 'Który podróżnik opłynął Ziemię?',
    answers: [
      { content: 'Ferdynand Magellan', isCorrect: true },
      { content: 'Krzysztof Kolumb', isCorrect: false },
      { content: 'James Cook', isCorrect: false },
    ],
  },
  {
    bank: 'geografia',
    type: 'true_false',
    content: 'Magellan opłynął Ziemię.',
    answers: [
      { content: 'Prawda', isCorrect: true },
      { content: 'Fałsz', isCorrect: false },
    ],
  },
  {
    bank: 'geografia',
    type: 'true_false',
    content: 'Kolumb dotarł do Indii.',
    answers: [
      { content: 'Prawda', isCorrect: false },
      { content: 'Fałsz', isCorrect: true },
    ],
  },
  {
    bank: 'geografia',
    type: 'open',
    content: 'Wyjaśnij znaczenie odkryć geograficznych.',
    answers: [],
  },
  {
    bank: 'geografia',
    type: 'open',
    content: 'Wymień dwa skutki wielkich odkryć.',
    answers: [],
  },
];

interface CardSpec {
  deck: DeckKey;
  topic: TopicKey;
  front: string;
  back: string;
}

/** 2 decks × 4 cards, one topic per deck (8 flashcards, 2 topics). */
const CARDS: CardSpec[] = [
  {
    deck: 'historia',
    topic: 'historia',
    front: 'Upadek Konstantynopola',
    back: '1453',
  },
  { deck: 'historia', topic: 'historia', front: 'Chrzest Polski', back: '966' },
  {
    deck: 'historia',
    topic: 'historia',
    front: 'Pierwszy król Polski',
    back: 'Bolesław Chrobry',
  },
  {
    deck: 'historia',
    topic: 'historia',
    front: 'Kiedy upadł Konstantynopol?',
    back: '1453',
  },
  {
    deck: 'geografia',
    topic: 'geografia',
    front: 'Odkrywca Ameryki',
    back: 'Kolumb',
  },
  {
    deck: 'geografia',
    topic: 'geografia',
    front: 'Pierwsza podróż dookoła Ziemi',
    back: 'Magellan',
  },
  {
    deck: 'geografia',
    topic: 'geografia',
    front: 'Wielkie odkrycia',
    back: 'XV w.',
  },
  { deck: 'geografia', topic: 'geografia', front: 'Kolumb', back: '1492' },
];

const STATS_URL = '/api/v1/stats/teacher';
const FLASHCARD_STATS_URL = '/api/v1/flashcards/stats/teacher';
const BANKS_URL = '/api/v1/questions/banks';
const DECKS_URL = '/api/v1/flashcards/decks';
const TOPICS_URL = '/api/v1/topics';
const QUESTIONS_URL = '/api/v1/questions';
const FLASHCARDS_URL = '/api/v1/flashcards';

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface NamedItem {
  id: string;
  name: string;
}

interface ListResult<T> {
  items: T[];
}

interface QuestionItem {
  id: string;
  content: string;
  type: string;
}

interface FlashcardItem {
  id: string;
  front: string;
  deck_id: string | null;
}

interface TeacherFlashcardSummary {
  totalDecks: number;
  totalFlashcards: number;
  practicingStudents: number;
  rosterStudents: number | null;
}

/** The content the spec prepared, keyed by the case's bank/deck/topic names. */
interface PreparedContent {
  banks: Record<BankKey, string>;
  decks: Record<DeckKey, string>;
  topics: Record<TopicKey, string>;
}

/** `GET` an endpoint and unwrap the `{ success, data }` envelope. */
async function getData<T>(request: APIRequestContext, url: string): Promise<T> {
  const response = await request.get(url);
  expect(response.ok(), `GET ${url} → ${response.status()} ${await response.text()}`).toBe(true);
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data;
}

/** `POST` an endpoint and require the created (201) envelope. */
async function postData<T>(request: APIRequestContext, url: string, data: unknown): Promise<T> {
  const response = await request.post(url, { data });
  expect(response.status(), `POST ${url} → ${response.status()} ${await response.text()}`).toBe(
    201,
  );
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(body.success, `POST ${url} success flag`).toBe(true);
  return body.data;
}

async function listNamed(request: APIRequestContext, url: string): Promise<NamedItem[]> {
  const result = await getData<ListResult<NamedItem>>(request, `${url}?limit=100`);
  return result.items;
}

/**
 * The tenant seeder enrols group members with the group `member` role, but only a
 * group `teacher` may share a bank/deck to the group (`canShareContentToGroups`).
 * Promote the educator through the manager's own roster endpoint — the same write
 * `/manage/groups` performs — keeping every other member untouched. Idempotent.
 */
async function ensureEducatorLeadsGroup(page: Page, tenant: QaTenant): Promise<void> {
  const groupId = tenant.group?.id;
  const educator = tenant.users.teacher;
  if (!groupId || !educator) {
    throw new Error(`${CASE} needs the content tenant profile (org, group and educator)`);
  }

  const url = `/api/v1/organization/groups/${groupId}/members`;
  const roster = await getData<Array<{ userId: string; role: 'teacher' | 'member' }>>(
    page.request,
    url,
  );
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

  const after = await getData<Array<{ userId: string; role: 'teacher' | 'member' }>>(
    page.request,
    url,
  );
  expect(
    after.find((row) => row.userId === educator.id)?.role,
    'the educator now teaches the tenant group',
  ).toBe('teacher');
}

/** Create one named item (bank/deck/topic) if the tenant does not have it yet. */
async function ensureNamed(
  page: Page,
  url: string,
  name: string,
  groupId: string,
): Promise<string> {
  const existing = (await listNamed(page.request, url)).find((item) => item.name === name);
  if (existing) return existing.id;
  const created = await postData<NamedItem>(page.request, url, {
    name,
    visibility: 'group',
    groupIds: [groupId],
  });
  return created.id;
}

/**
 * Prepare the case's content inside the tenant: promote the educator, then create
 * the two banks with their ten questions, the two group decks with four cards each
 * and the two topics. Everything goes through the product API and is idempotent, so
 * a CI retry on the same tenant reuses the rows instead of duplicating them.
 */
async function prepareContent(page: Page, tenant: QaTenant): Promise<PreparedContent> {
  const groupId = tenant.group?.id;
  if (!groupId) throw new Error(`${CASE} needs the content tenant profile (org + group)`);

  await loginAs(page, tenant, 'manager', {
    locale: 'pl',
    waitFor: /\/manage(\/|$)/,
  });
  await ensureEducatorLeadsGroup(page, tenant);

  await loginAs(page, tenant, 'teacher', {
    locale: 'pl',
    waitFor: /\/edu(\/|$)/,
  });

  const banks = {} as Record<BankKey, string>;
  const decks = {} as Record<DeckKey, string>;
  const topics = {} as Record<TopicKey, string>;

  for (const key of Object.keys(BANKS) as BankKey[]) {
    banks[key] = await ensureNamed(page, BANKS_URL, BANKS[key], groupId);
  }
  for (const key of Object.keys(DECKS) as DeckKey[]) {
    decks[key] = await ensureNamed(page, DECKS_URL, DECKS[key], groupId);
  }
  for (const key of Object.keys(TOPICS) as TopicKey[]) {
    topics[key] = await ensureNamed(page, TOPICS_URL, TOPICS[key], groupId);
  }

  // Questions are matched by their content inside the bank they belong to.
  for (const bankKey of Object.keys(BANKS) as BankKey[]) {
    const existing = await getData<QuestionItem[]>(
      page.request,
      `${QUESTIONS_URL}?bankId=${banks[bankKey]}`,
    );
    const known = new Set(existing.map((question) => question.content));
    for (const spec of QUESTIONS.filter((question) => question.bank === bankKey)) {
      if (known.has(spec.content)) continue;
      await postData<QuestionItem>(page.request, QUESTIONS_URL, {
        bankId: banks[bankKey],
        type: spec.type,
        content: spec.content,
        answers: spec.answers.map((answer, index) => ({
          ...answer,
          orderIndex: index,
        })),
      });
    }
  }

  // Flashcards are matched by their front inside the deck they belong to.
  for (const deckKey of Object.keys(DECKS) as DeckKey[]) {
    const existing = await getData<ListResult<FlashcardItem>>(
      page.request,
      `${FLASHCARDS_URL}?deckIds=${decks[deckKey]}&limit=100`,
    );
    const known = new Set(existing.items.map((card) => card.front));
    for (const spec of CARDS.filter((card) => card.deck === deckKey)) {
      if (known.has(spec.front)) continue;
      await postData<FlashcardItem>(page.request, FLASHCARDS_URL, {
        deckId: decks[deckKey],
        front: spec.front,
        back: spec.back,
        topicIds: [topics[spec.topic]],
      });
    }
  }

  return { banks, decks, topics };
}

/**
 * Retry-safety: CI seeds a case tenant once and reuses it for every retry, so a
 * previous attempt's practice rows would make „Aktywnych” start at 1. The product
 * exposes no "clear my history" action, so cleanup goes through the suite's
 * service-role client — tenant-local rows only (this tenant's own user ids), the
 * same pattern STU-02 uses.
 */
async function resetPracticeState(tenant: QaTenant): Promise<void> {
  const userIds = Object.values(tenant.users).flatMap((user) => (user ? [user.id] : []));
  expect(userIds.length, `${CASE} tenant users`).toBeGreaterThan(0);
  const db = createQaSupabase();

  const practice = await db.from('flashcard_practice').delete().in('user_id', userIds).select('id');
  expect(
    practice.error,
    `delete ${CASE} practice rows: ${practice.error?.message ?? ''}`,
  ).toBeNull();

  const reviews = await db
    .from('flashcard_review_state')
    .delete()
    .in('user_id', userIds)
    .select('flashcard_id');
  expect(reviews.error, `delete ${CASE} review state: ${reviews.error?.message ?? ''}`).toBeNull();
}

/** Log one practice of a card through the product API, as the signed-in user. */
async function practice(page: Page, flashcardId: string): Promise<void> {
  const response = await page.request.post(`${FLASHCARDS_URL}/${flashcardId}/practice`, {
    data: { wasCorrect: true, responseTimeMs: 1500, mode: 'review' },
  });
  expect(
    response.status(),
    `POST ${FLASHCARDS_URL}/${flashcardId}/practice → ${response.status()} ${await response.text()}`,
  ).toBe(201);
}

async function readFlashcardSummary(page: Page): Promise<TeacherFlashcardSummary> {
  const body = await getData<{ summary: TeacherFlashcardSummary }>(
    page.request,
    FLASHCARD_STATS_URL,
  );
  return body.summary;
}

/** The StatCard that carries this title (its title is the card's only `p` with it). */
function statCard(page: Page, title: RegExp): Locator {
  return page
    .locator('div.rounded-xl.border')
    .filter({ has: page.getByText(title) })
    .first();
}

/** The summary-card grid (the only `grid gap-4` on both stats screens). */
function statGrid(page: Page): Locator {
  return page.locator('div.grid.gap-4');
}

/** A `label / count` row inside a breakdown card. */
function breakdownRow(card: Locator, label: string): Locator {
  return card.locator('div.flex.items-center.justify-between').filter({ hasText: label });
}

/** Uncaught errors and failed documents for the whole walk. */
function watchPage(page: Page) {
  const pageErrors: string[] = [];
  const failedDocuments: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => {
    if (response.request().resourceType() === 'document' && response.status() >= 400) {
      failedDocuments.push(`${response.status()} ${new URL(response.url()).pathname}`);
    }
  });
  return { pageErrors, failedDocuments };
}

let tenant: QaTenant;

test.beforeAll(() => {
  tenant = loadTenant(CASE);
  expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
});

test.describe('@case:EDU-ST-01 @area:EDU @prio:P2 educator content statistics', () => {
  test('shows the content breakdown, the subject filter and the stats links', async ({ page }) => {
    test.setTimeout(180_000);
    const { pageErrors, failedDocuments } = watchPage(page);

    const content = await prepareContent(page, tenant);
    await page.goto('/edu/stats/data');
    await expect(page).toHaveURL(/\/edu\/stats\/data$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
    await expect(page.getByRole('heading', { name: COPY.title, exact: true })).toBeVisible();

    // ── The four summary cards ─────────────────────────────────────────────
    const grid = statGrid(page);
    await expect(grid.locator('div.rounded-xl.border')).toHaveCount(4);
    await expect(statCard(page, /^wszystkie pytania$/i).getByText(/^\d+$/)).toHaveText('10');
    await expect(statCard(page, /^wszystkie fiszki$/i).getByText(/^\d+$/)).toHaveText('8');
    await expect(statCard(page, /^wszystkie talie$/i).getByText(/^\d+$/)).toHaveText('2');

    // „Studenci” is the class size of the educator's groups in the active
    // organization (one seeded student, the educator excluded), not the number of
    // practisers — that one sits in the description below the value.
    const students = statCard(page, /^studenci$/i);
    await expect(students.getByText(/^\d+$/)).toHaveText('1');
    await expect(students).toContainText(/Aktywnych: \d+/);

    // ── The question split ─────────────────────────────────────────────────
    const typeCard = statCard(page, /^pytania według typu$/i);
    await expect(breakdownRow(typeCard, COPY.mcq)).toHaveText(new RegExp(`^${COPY.mcq}\\s*4$`));
    await expect(breakdownRow(typeCard, COPY.trueFalse)).toHaveText(
      new RegExp(`^${COPY.trueFalse}\\s*3$`),
    );
    await expect(breakdownRow(typeCard, COPY.open)).toHaveText(new RegExp(`^${COPY.open}\\s*3$`));

    const subjectCard = statCard(page, /^pytania według przedmiotu$/i);
    await expect(breakdownRow(subjectCard, BANKS.geografia)).toHaveText(
      new RegExp(`^${BANKS.geografia}\\s*6$`),
    );
    await expect(breakdownRow(subjectCard, BANKS.historia)).toHaveText(
      new RegExp(`^${BANKS.historia}\\s*4$`),
    );

    // ── The deck and topic tables ──────────────────────────────────────────
    const deckCard = statCard(page, /^liczby talii$/i);
    await expect(deckCard.locator('tbody tr')).toHaveCount(2);
    for (const key of Object.keys(DECKS) as DeckKey[]) {
      const row = deckCard.locator('tbody tr').filter({ hasText: DECKS[key] });
      await expect(row, `deck row "${DECKS[key]}"`).toHaveCount(1);
      await expect(row).toContainText('4');
      await expect(row.getByRole('link')).toHaveAttribute(
        'href',
        `/edu/flashcards/${content.decks[key]}`,
      );
    }

    const topicCard = statCard(page, /^liczby tematów$/i);
    await expect(topicCard.locator('tbody tr')).toHaveCount(2);
    for (const key of Object.keys(TOPICS) as TopicKey[]) {
      const row = topicCard.locator('tbody tr').filter({ hasText: TOPICS[key] });
      await expect(row, `topic row "${TOPICS[key]}"`).toHaveCount(1);
      await expect(row).toContainText('4');
    }

    // ── Step 2: the subject filter ─────────────────────────────────────────
    const subjectSelect = page.locator('[data-slot="select-trigger"]');
    await expect(subjectSelect).toContainText(COPY.allSubjects);
    await subjectSelect.click();
    const options = page.getByRole('option');
    await expect(options).toHaveCount(3);
    expect((await options.allInnerTexts()).sort(), 'subject filter options').toEqual(
      [COPY.allSubjects, BANKS.geografia, BANKS.historia].sort(),
    );

    const filtered = page.waitForRequest((request) => {
      if (!request.url().includes(`${STATS_URL}?`)) return false;
      return new URL(request.url()).searchParams.get('subjectId') === content.banks.historia;
    });
    await page.getByRole('option', { name: BANKS.historia, exact: true }).click();
    await filtered;

    await expect(subjectSelect).toContainText(BANKS.historia);
    // „Historia” holds 4 questions: 2 mcq, 1 true/false, 1 open.
    await expect(breakdownRow(typeCard, COPY.mcq)).toHaveText(new RegExp(`^${COPY.mcq}\\s*2$`));
    await expect(breakdownRow(typeCard, COPY.trueFalse)).toHaveText(
      new RegExp(`^${COPY.trueFalse}\\s*1$`),
    );
    await expect(breakdownRow(typeCard, COPY.open)).toHaveText(new RegExp(`^${COPY.open}\\s*1$`));
    // The totals and the by-subject overview stay global: the filter explains them.
    await expect(statCard(page, /^wszystkie pytania$/i).getByText(/^\d+$/)).toHaveText('10');
    await expect(breakdownRow(subjectCard, BANKS.geografia)).toHaveText(
      new RegExp(`^${BANKS.geografia}\\s*6$`),
    );

    // ── The two drill-down links ───────────────────────────────────────────
    await page.getByRole('link', { name: COPY.viewQuestionStats }).click();
    await expect(page).toHaveURL(/\/edu\/statistics$/);
    await expect(
      page.getByRole('heading', { name: COPY.statisticsTitle, exact: true }),
    ).toBeVisible();

    await page.goto('/edu/stats/data');
    await page.getByRole('link', { name: COPY.viewFlashcardStats }).click();
    await expect(page).toHaveURL(/\/edu\/flashcards\/stats$/);
    await expect(
      page.getByRole('heading', {
        name: COPY.flashcardStatsTitle,
        exact: true,
      }),
    ).toBeVisible();
    // The student card keeps its own label and the six-card grid is unchanged.
    const flashGrid = statGrid(page);
    await expect(flashGrid.locator('div.rounded-xl.border')).toHaveCount(6);
    await expect(statCard(page, /^studenci, którzy ćwiczyli$/i)).toBeVisible();

    expect(failedDocuments, 'no navigation may answer with an error status').toEqual([]);
    expect(pageErrors, 'uncaught page errors during the walk').toEqual([]);
  });

  test('counts the class in the Students card and only a student practice moves „Aktywnych”', async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    const { pageErrors } = watchPage(page);

    const content = await prepareContent(page, tenant);
    await resetPracticeState(tenant);

    const summary = await readFlashcardSummary(page);
    expect(summary.rosterStudents, 'the seeded class size').toBe(1);
    expect(summary.practicingStudents, 'nobody practised yet').toBe(0);

    // The educator's own practice must never count as a student (#460).
    const cards = await getData<ListResult<FlashcardItem>>(
      page.request,
      `${FLASHCARDS_URL}?deckIds=${content.decks.historia}&limit=100`,
    );
    const target = cards.items[0];
    expect(target, 'the „Historia – fiszki” deck has a card to practise').toBeTruthy();
    await practice(page, target.id);

    const afterTeacher = await readFlashcardSummary(page);
    expect(afterTeacher.practicingStudents, 'the educator is not a student').toBe(0);

    await page.goto('/edu/stats/data');
    const students = statCard(page, /^studenci$/i);
    await expect(students.getByText(/^\d+$/)).toHaveText('1');
    await expect(students).toContainText('Aktywnych: 0');
    const progress = students.locator('div[style*="width"]');
    await expect(progress).toHaveAttribute('style', /width:\s*0%/);

    // One practice by the student, in the student's own session.
    const studentContext = await browser.newContext({ baseURL });
    try {
      const studentPage = await studentContext.newPage();
      await loginAs(studentPage, tenant, 'student', {
        locale: 'pl',
        waitFor: /\/app(\/|$)/,
      });
      await practice(studentPage, target.id);
    } finally {
      await studentContext.close();
    }

    await page.reload();
    await expect(students.getByText(/^\d+$/)).toHaveText('1');
    await expect(students).toContainText('Aktywnych: 1');
    await expect(students.locator('div[style*="width"]')).toHaveAttribute('style', /width:\s*100%/);

    // The flashcard hub keeps the same six cards, with the „Studenci, którzy
    // ćwiczyli” label carrying the active count.
    await page.goto('/edu/flashcards/stats');
    await expect(
      page.getByRole('heading', {
        name: COPY.flashcardStatsTitle,
        exact: true,
      }),
    ).toBeVisible();
    await expect(statGrid(page).locator('div.rounded-xl.border')).toHaveCount(6);
    const practising = statCard(page, /^studenci, którzy ćwiczyli$/i);
    await expect(practising.getByText(/^\d+$/)).toHaveText('1');

    expect(pageErrors, 'uncaught page errors during the walk').toEqual([]);
  });

  test('reports no roster without an active organization and the class size after switching', async ({
    request,
  }) => {
    const educator = tenant.users.teacher;
    const organization = tenant.org;
    if (!educator || !organization) {
      throw new Error(`${CASE} needs the content tenant profile (org + educator)`);
    }

    const login = await request.post('/api/v1/auth/login', {
      data: { email: educator.email, password: educator.password },
    });
    expect(login.ok(), `login ${educator.email} → ${login.status()}`).toBe(true);

    // No active organization: the payload says `null`, so the page hides the card
    // instead of rendering a bare 0. (The app always selects the only membership in
    // the browser; a teacher without any organization is sent to `/setup`.)
    const before = await getData<{ summary: TeacherFlashcardSummary }>(
      request,
      FLASHCARD_STATS_URL,
    );
    expect(before.summary.rosterStudents, 'no active organization → no roster').toBeNull();

    const switched = await request.post('/api/v1/me/orgs/switch', {
      data: { orgId: organization.id },
    });
    expect(switched.ok(), `switch → ${switched.status()} ${await switched.text()}`).toBe(true);

    const after = await getData<{ summary: TeacherFlashcardSummary }>(request, FLASHCARD_STATS_URL);
    expect(after.summary.rosterStudents, 'the active organization’s class size').toBe(1);
  });
});
