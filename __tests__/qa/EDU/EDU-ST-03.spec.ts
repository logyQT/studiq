import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { createQaSupabase } from '@qa/fixtures/qa-db';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * EDU-ST-03 — Statystyki nauczyciela: „Aktywność” (`/edu/stats/activity`).
 *
 * Case steps: open the page, switch the range 7 / 30 / 90 days. Expected: the four
 * summary cards („Aktywni studenci”, „Łącznie powtórki”, „Śr. poprawność”,
 * „Wykonane testy”) with a comparison to the previous period, the daily-activity
 * chart, the „Zaangażowanie studentów” table with a status badge, and
 * „Brak danych o aktywności w tym okresie” for a period without activity.
 *
 * (The case also lists an „Aktywność testowa” card. Product decision #208 removed
 * it — the card grouped practice attempts by `quiz_attempts.config.difficulty`, a
 * value nothing writes — so the intended page has no such card and this spec does
 * not expect one. Attempt counts remain in „Wykonane testy” and the per-student
 * „Testy” column.)
 *
 * Tenant (deterministic `content` profile — org + manager/educator/student + the
 * default group `G1`, declared in `__tests__/qa/profiles/EDU-ST-03.json`), fresh run
 * suffix per independent run:
 *
 *   bun scripts/qa-tenant.ts EDU-ST-03 --fresh
 *
 * gives `qa-edu-st-03-<suffix>` with every id derived from
 * `tenantKey('qa/cases/EDU-ST-03.md', 'EDU-ST-03#<suffix>', 'qa-shared')` +
 * `tenantId`; the spec reads them through `loadTenant` and never reuses a legacy
 * `@dev.local` account. The teacher is the page's author; the student builds the
 * activity through the product API in a second browser context (three practices —
 * two correct, one wrong — and one completed practice quiz), so the cards show
 * real numbers from this tenant only. Nothing global is read or written: no admin
 * setting, feature flag, plan, platform stat or singleton row, and no other
 * worker's tenant.
 *
 * CI seeds a case tenant once and Playwright retries reuse it, so the test starts
 * by clearing this tenant student's own activity aggregates (practice, daily
 * counters, attempts, the decks/banks the spec created). The page derives every
 * number from those rows, and a retry must start from the empty period again.
 *
 * Acceptance points (walked on the shared app :3010, worker qa-env-2):
 * 1. A tenant with no activity shows „Brak danych o aktywności w tym okresie” for
 *    7, 30 and 90 days — no summary cards, chart or table (the #209 empty state).
 * 2. The range buttons are 7 dni / 30 dni / 90 dni; the selected one is the
 *    primary button, every click requests `/api/v1/stats/teacher/activity` with
 *    that range and returns 7, 30 or 90 daily points.
 * 3. Activity in the current period renders the four cards with the real values,
 *    each carrying „brak danych w poprzednim okresie” while the previous period is
 *    empty (the #211 no-baseline state).
 * 4. „Aktywność dzienna” renders the chart („Powtórki” bars, „Aktywni studenci”
 *    line) with the active range as its description.
 * 5. „Zaangażowanie studentów” lists Student / Ostatnia aktywność / Powtórki /
 *    Poprawność / Testy / Status; the tenant student reads „Dzisiaj”, 3, 67%, 1,
 *    „🟢 Aktywny” and is the only active row.
 * 6. Switching to 30 and 90 days keeps the same totals (all activity is today)
 *    and updates the chart and table descriptions to the chosen range.
 *
 * The suite's service-role client only touches rows this tenant student owns
 * (retry cleanup), never another tenant's data.
 */

const CASE = 'EDU-ST-03';
const PAGE_PATH = '/edu/stats/activity';
const ACTIVITY_API = '/api/v1/stats/teacher/activity';

/** Polish copy from `TeacherActivityPage` (pl.json). */
const COPY = {
  title: 'Aktywność studentów',
  description: 'Monitoruj zaangażowanie swoich studentów',
  empty: 'Brak danych o aktywności w tym okresie',
  noBaseline: 'brak danych w poprzednim okresie',
  vsPrevious: 'w porównaniu do poprzedniego okresu',
  chart: 'Aktywność dzienna',
  reviews: 'Powtórki',
  activeStudents: 'Aktywni studenci',
  table: 'Zaangażowanie studentów',
  columns: ['Student', 'Ostatnia aktywność', 'Powtórki', 'Poprawność', 'Testy', 'Status'],
} as const;

const RANGES = [
  { value: '7d', label: '7 dni', points: 7 },
  { value: '30d', label: '30 dni', points: 30 },
  { value: '90d', label: '90 dni', points: 90 },
] as const;

/** The four summary cards, in the page's order, with the values this fixture produces. */
const SUMMARY = [
  { title: 'Aktywni studenci', value: '1' },
  { title: 'Łącznie powtórki', value: '3' },
  { title: 'Śr. poprawność', value: '67%' },
  { title: 'Wykonane testy', value: '1' },
] as const;

/** `buildAccount` names the tenant's student `QA student`; the table renders `full_name`. */
const STUDENT_NAME = 'QA student';

const PRACTICES = { total: 3, correct: 2, accuracy: '67%' } as const;

const QUESTION = {
  content: 'EDU-ST-03: które miasto jest stolicą Polski?',
  correct: 'Warszawa',
  wrong: 'Kraków',
} as const;

interface Envelope<T> {
  success: boolean;
  data: T;
  error?: string;
}

interface ActivityData {
  summary: {
    activeStudents: { current: number; previous: number };
    totalPractices: { current: number; previous: number };
    avgAccuracy: { current: number; previous: number };
    totalQuizzes: { current: number; previous: number };
  };
  dailyActivity: Array<{ date: string; reviews: number; activeStudents: number }>;
  students: Array<{
    id: string;
    name: string;
    email: string;
    lastActive: string | null;
    practices7d: number;
    accuracy7d: number | null;
    quizzes7d: number;
    status: 'active' | 'recent' | 'check_in';
  }>;
}

interface Question {
  id: string;
  content: string;
  question_answers: Array<{ id: string; content: string; is_correct: boolean }>;
}

/** The Card whose title is exactly `title` (chart legends reuse some titles). */
function cardWithTitle(page: Page, title: string): Locator {
  return page.locator('[data-slot="card"]').filter({
    has: page
      .locator('[data-slot="card-title"]')
      .filter({ hasText: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }),
  });
}

function rangeButton(page: Page, label: string): Locator {
  return page.getByRole('button', { name: label, exact: true });
}

/** `POST` and require the created (201) envelope, returning its `data`. */
async function postData<T>(page: Page, url: string, data: unknown): Promise<T> {
  const response = await page.request.post(url, { data });
  const body = (await response.json()) as Envelope<T>;
  expect(response.status(), `POST ${url} → ${response.status()} ${JSON.stringify(body)}`).toBe(201);
  expect(body.success, `POST ${url} success flag`).toBe(true);
  return body.data;
}

/**
 * Retry safety: CI seeds the case tenant once and reuses it for every retry, so
 * this test clears only its own tenant student's activity before each attempt.
 * A deck cascades its flashcards (and their practice/review rows); a bank
 * cascades its questions; quiz attempts cascade their answers. Daily counters are
 * a per-user aggregate with no delete trigger, so they are removed explicitly.
 */
async function resetStudentActivity(tenant: QaTenant): Promise<void> {
  const student = tenant.users.student;
  if (!student) throw new Error(`${CASE} tenant has no student account`);
  if (!tenant.org) throw new Error(`${CASE} tenant has no organization`);
  const db = createQaSupabase();

  const attempts = await db.from('quiz_attempts').delete().eq('user_id', student.id).select('id');
  expect(
    attempts.error,
    `delete ${CASE} quiz attempts: ${attempts.error?.message ?? ''}`,
  ).toBeNull();

  const practice = await db
    .from('flashcard_practice')
    .delete()
    .eq('user_id', student.id)
    .select('id');
  expect(
    practice.error,
    `delete ${CASE} practice rows: ${practice.error?.message ?? ''}`,
  ).toBeNull();

  const reviews = await db
    .from('flashcard_review_state')
    .delete()
    .eq('user_id', student.id)
    .select('flashcard_id');
  expect(reviews.error, `delete ${CASE} review state: ${reviews.error?.message ?? ''}`).toBeNull();

  const daily = await db
    .from('user_daily_activity')
    .delete()
    .eq('user_id', student.id)
    .select('date');
  expect(daily.error, `delete ${CASE} daily activity: ${daily.error?.message ?? ''}`).toBeNull();

  const banks = await db
    .from('question_banks')
    .delete()
    .eq('created_by', student.id)
    .eq('organization_id', tenant.org.id)
    .select('id');
  expect(banks.error, `delete ${CASE} question banks: ${banks.error?.message ?? ''}`).toBeNull();

  const decks = await db
    .from('flashcard_decks')
    .delete()
    .eq('created_by', student.id)
    .eq('organization_id', tenant.org.id)
    .select('id');
  expect(decks.error, `delete ${CASE} flashcard decks: ${decks.error?.message ?? ''}`).toBeNull();
}

/**
 * Build the activity the page must report: the tenant student practices three
 * cards (two correct, one wrong) and completes one practice quiz. Everything goes
 * through the product API in that student's own session, in a separate browser
 * context so the teacher's page keeps its session.
 */
async function seedStudentActivity(
  browser: Browser,
  tenant: QaTenant,
  baseURL: string | undefined,
): Promise<void> {
  const context = await browser.newContext({ baseURL });
  try {
    const studentPage = await context.newPage();
    await loginAs(studentPage, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });

    const suffix = tenant.runSuffix ?? tenant.key.slice(-6);
    const deck = await postData<{ id: string }>(studentPage, '/api/v1/flashcards/decks', {
      name: `EDU-ST-03 activity ${suffix}`,
    });

    for (let index = 1; index <= PRACTICES.total; index += 1) {
      const card = await postData<{ id: string }>(studentPage, '/api/v1/flashcards', {
        deckId: deck.id,
        front: `EDU-ST-03 front ${index}`,
        back: `EDU-ST-03 back ${index}`,
      });
      const practice = await studentPage.request.post(`/api/v1/flashcards/${card.id}/practice`, {
        data: { wasCorrect: index <= PRACTICES.correct, confidenceLevel: 4 },
      });
      expect(practice.status(), `POST /api/v1/flashcards/${card.id}/practice (card ${index})`).toBe(
        201,
      );
    }

    const bank = await postData<{ id: string }>(studentPage, '/api/v1/questions/banks', {
      name: `EDU-ST-03 bank ${suffix}`,
    });
    const question = await postData<Question>(studentPage, '/api/v1/questions', {
      bankId: bank.id,
      type: 'mcq',
      content: QUESTION.content,
      answers: [
        { content: QUESTION.correct, isCorrect: true, orderIndex: 0 },
        { content: QUESTION.wrong, isCorrect: false, orderIndex: 1 },
      ],
    });

    const correctOption = question.question_answers.find(
      (answer) => answer.content === QUESTION.correct,
    );
    expect(correctOption, `„${QUESTION.correct}” is the stored correct option`).toBeTruthy();

    const attempt = await postData<{ id: string }>(studentPage, '/api/v1/quiz/new', {
      bankId: bank.id,
      questionTypes: ['mcq'],
      questionCount: 1,
    });
    const submitted = await studentPage.request.post(`/api/v1/quiz/${attempt.id}`, {
      data: {
        attemptId: attempt.id,
        answers: [{ questionId: question.id, selectedAnswerId: correctOption!.id }],
      },
    });
    expect(submitted.status(), `POST /api/v1/quiz/${attempt.id}`).toBe(200);
    expect((await submitted.json()) as Envelope<{ score: number }>).toMatchObject({
      data: { score: 1, totalQuestions: 1 },
    });
  } finally {
    await context.close();
  }
}

/**
 * Click a range and wait for its own API call. Returns the payload so the caller
 * can check the day count, which proves the range reached the service — the page
 * otherwise renders the same totals for every window.
 */
async function switchRange(page: Page, range: (typeof RANGES)[number]): Promise<ActivityData> {
  const expected = `${ACTIVITY_API}?range=${range.value}`;
  const pending = page.waitForResponse(
    (response) => response.url().includes(expected) && response.request().method() === 'GET',
  );
  await rangeButton(page, range.label).click();
  const response = await pending;
  expect(response.status(), `GET ${expected}`).toBe(200);
  const body = (await response.json()) as Envelope<ActivityData>;
  expect(body.success, `GET ${expected} success flag`).toBe(true);
  expect(body.data.dailyActivity, `GET ${expected} covers ${range.points} days`).toHaveLength(
    range.points,
  );
  await expect(
    rangeButton(page, range.label),
    `„${range.label}” is rendered as the active range`,
  ).toHaveClass(/bg-primary/);
  return body.data;
}

async function expectEmptyPeriod(page: Page, range: (typeof RANGES)[number]): Promise<void> {
  await expect(
    page.getByText(COPY.empty, { exact: true }),
    `„${COPY.empty}” for ${range.label}`,
  ).toBeVisible();
  await expect(
    page.locator('[data-slot="card-title"]'),
    `${range.label}: no summary, chart or table card`,
  ).toHaveCount(0);
}

async function expectActivity(page: Page, range: (typeof RANGES)[number]): Promise<void> {
  await expect(page.getByText(COPY.empty, { exact: true })).toHaveCount(0);

  for (const { title, value } of SUMMARY) {
    const card = cardWithTitle(page, title);
    await expect(card, `${range.label}: „${title}” card`).toHaveCount(1);
    await expect(card.locator('p').first(), `${range.label}: „${title}” value`).toHaveText(value);
    await expect(card, `${range.label}: „${title}” states there is no baseline`).toContainText(
      COPY.noBaseline,
    );
    await expect(
      card,
      `${range.label}: „${title}” has no percentage against an empty baseline`,
    ).not.toContainText(COPY.vsPrevious);
  }

  const chart = cardWithTitle(page, COPY.chart);
  await expect(chart, `„${COPY.chart}” card`).toHaveCount(1);
  await expect(
    chart.locator('[data-slot="card-description"]'),
    `${range.label}: chart description`,
  ).toHaveText(range.label);
  await expect(chart.locator('svg.recharts-surface'), 'the chart is rendered').toBeVisible();
  await expect(chart.getByText(COPY.reviews, { exact: true }), '„Powtórki” legend').toHaveCount(1);
  await expect(
    chart.getByText(COPY.activeStudents, { exact: true }),
    '„Aktywni studenci” legend',
  ).toHaveCount(1);

  const table = cardWithTitle(page, COPY.table);
  await expect(table, `„${COPY.table}” card`).toHaveCount(1);
  await expect(
    table.locator('[data-slot="card-description"]'),
    `${range.label}: table description`,
  ).toHaveText(range.label);
  await expect(table.locator('thead th'), `${range.label}: table columns`).toHaveText([
    ...COPY.columns,
  ]);

  const row = table.locator('tbody tr').filter({ hasText: STUDENT_NAME });
  await expect(row, `${range.label}: the tenant student's row`).toHaveCount(1);
  const cells = row.getByRole('cell');
  await expect(cells, `${range.label}: one cell per column`).toHaveCount(COPY.columns.length);
  await expect(cells.nth(0), 'student name').toHaveText(STUDENT_NAME);
  await expect(cells.nth(1), 'last activity is today').toHaveText('Dzisiaj');
  await expect(cells.nth(2), 'practices in the period').toHaveText(String(PRACTICES.total));
  await expect(cells.nth(3), 'accuracy in the period').toHaveText(PRACTICES.accuracy);
  await expect(cells.nth(4), 'quizzes in the period').toHaveText('1');
  await expect(cells.nth(5), 'status badge').toContainText('Aktywny');
  await expect(cells.nth(5), 'active status marker').toContainText('🟢');
  await expect(
    table.locator('[data-slot="badge"]').filter({ hasText: 'Aktywny' }),
    `${range.label}: only the practicing student is active`,
  ).toHaveCount(1);
}

async function openActivityPage(page: Page): Promise<void> {
  const pending = page.waitForResponse(
    (response) =>
      response.url().includes(`${ACTIVITY_API}?range=7d`) && response.request().method() === 'GET',
  );
  await page.goto(PAGE_PATH);
  const response = await pending;
  expect(response.status(), `GET ${ACTIVITY_API}?range=7d`).toBe(200);
  await expect(page).toHaveURL(new RegExp(`${PAGE_PATH}$`));
}

test.describe('@case:EDU-ST-03 @area:EDU @prio:P2 teacher activity statistics', () => {
  test('shows the empty period, then cards, chart, engagement table and every range', async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);

    const pageErrors: string[] = [];
    const failedActivityCalls: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('response', (response) => {
      if (response.url().includes(ACTIVITY_API) && response.status() >= 400) {
        failedActivityCalls.push(`${response.status()} ${response.url()}`);
      }
    });

    const tenant: QaTenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    expect(tenant.org, 'the tenant has an organization').toBeTruthy();
    expect(tenant.users.teacher, 'the tenant has an educator').toBeTruthy();
    expect(tenant.users.student, 'the tenant has a student').toBeTruthy();

    // A retried run shares the seeded tenant; start from a period with no activity.
    await resetStudentActivity(tenant);

    await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu(\/|$)/ });
    expect(new URL(page.url()).pathname, 'the educator lands on /edu').toBe('/edu');

    // --- Step 1: a period with no activity is the empty state -----------------
    await openActivityPage(page);
    await expect(
      page.getByRole('heading', { name: COPY.title, exact: true }),
      'page heading',
    ).toBeVisible();
    await expect(page.getByText(COPY.description, { exact: true })).toBeVisible();
    await expect(rangeButton(page, RANGES[0].label), '7 dni is the default range').toHaveClass(
      /bg-primary/,
    );
    await expectEmptyPeriod(page, RANGES[0]);

    // --- Step 2: the range switch requests each window and stays empty --------
    await switchRange(page, RANGES[1]);
    await expectEmptyPeriod(page, RANGES[1]);
    await switchRange(page, RANGES[2]);
    await expectEmptyPeriod(page, RANGES[2]);

    // --- Step 3: the tenant student's activity fills the page -----------------
    await seedStudentActivity(browser, tenant, baseURL);
    await openActivityPage(page);
    await expectActivity(page, RANGES[0]);

    // --- Step 4: the other windows keep today's totals ------------------------
    for (const range of [RANGES[1], RANGES[2]]) {
      const data = await switchRange(page, range);
      expect(data.summary.totalPractices.current, `${range.label}: practices`).toBe(
        PRACTICES.total,
      );
      expect(data.summary.totalQuizzes.current, `${range.label}: quizzes`).toBe(1);
      expect(data.summary.activeStudents.current, `${range.label}: active students`).toBe(1);
      expect(data.summary.avgAccuracy.current, `${range.label}: accuracy`).toBe(67);
      await expectActivity(page, range);
    }

    // Back to the default window: the page still reports the same period.
    const back = await switchRange(page, RANGES[0]);
    expect(back.summary.totalPractices.current, '7 dni after switching back').toBe(PRACTICES.total);
    await expectActivity(page, RANGES[0]);

    expect(failedActivityCalls, 'the activity endpoint never failed').toEqual([]);
    expect(pageErrors, 'no uncaught page errors').toEqual([]);
  });
});
