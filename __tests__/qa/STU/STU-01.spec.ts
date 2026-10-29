import { expect, test, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';
import { createQaSupabase } from '@qa/fixtures/qa-db';

/**
 * STU-01 — Pulpit studenta (`/app`): powitanie, karty statystyk, odmiana
 * liczebnika przy liczbie fiszek do powtórki i skróty „Kontynuuj przegląd” /
 * „Utwórz talię”.
 *
 * Tenant (deterministic `content` profile, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts STU-01 --fresh
 *
 * gives org `qa-stu-01-<suffix>` with a manager/teacher/student
 * (`tenantKey('qa/cases/STU-01.md', 'STU-01#<suffix>', 'qa-shared')`); the
 * dashboard belongs to the tenant's `student` (`QA student`). The spec never
 * reuses a legacy `@dev.local` account and never reads another worker's tenant.
 *
 * The seeded tenant is empty, so the spec builds its own deck and five cards
 * through the product API and records their practice. The only service-role
 * write is the documented "time" exception (`qa/fixtures/qa-db.ts`): the
 * review-state rows it just created are aged into the past so `dueToday`
 * reaches 1, 2 and 5 — that is the only way to exercise all three Polish
 * plural forms without waiting for the scheduler. Every row is keyed by a card
 * id created in this test, so no global, plan, flag or other tenant row is
 * touched.
 *
 * Acceptance points walked on 2026-10-28 (shared app :3010, QA worker
 * qa-env-3): greeting is the first token of `user_metadata.name`, the date
 * header is Polish, empty cards read 0 / — / 0 / 0% (never NaN/undefined),
 * the due sentence inflects 1 fiszkę / 2 fiszki / 5 fiszek, „Kontynuuj
 * przegląd” lands on `/app/study/learn`, „Utwórz talię” on `/app/flashcards`,
 * and the loading state is a pulsing skeleton placeholder (not literal „…”).
 */

const CASE = 'STU-01';

const STAT_CARDS = {
  practiced: /przećwiczone fiszki/i,
  average: /średni wynik/i,
  quizzes: /ukończone testy/i,
  accuracy: /skuteczność/i,
} as const;

/** The Card that owns a stat title (StatCard renders `title` + `value` as `<p>`s). */
function statCard(page: Page, title: RegExp) {
  return page.locator('div.bg-card').filter({ hasText: title }).first();
}

/** The value line of a loaded stat card. */
function statValue(page: Page, title: RegExp) {
  return statCard(page, title).locator('p').nth(1);
}

function dueSentence(count: number, noun: 'fiszkę' | 'fiszki' | 'fiszek'): string {
  return `Masz ${count} ${noun} do powtórki dzisiaj.`;
}

async function signInAsStudent(page: Page): Promise<QaTenant> {
  const tenant = loadTenant(CASE);
  expect(tenant.users.student, `${CASE} needs the tenant's student account`).toBeTruthy();
  await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app$/ });
  return tenant;
}

/**
 * Create this run's own deck and five cards through the product API, then log
 * one correct practice per card (all through the student's real session).
 */
async function createPracticedCards(page: Page, tenant: QaTenant): Promise<string[]> {
  const suffix = tenant.runSuffix ?? tenant.key.slice(-6);
  const deckResponse = await page.request.post('/api/v1/flashcards/decks', {
    data: { name: `STU-01 dashboard ${suffix}` },
  });
  expect(deckResponse.status(), 'POST /api/v1/flashcards/decks').toBe(201);
  const deck = (await deckResponse.json()) as { data: { id: string } };

  const cardIds: string[] = [];
  for (let index = 1; index <= 5; index += 1) {
    const cardResponse = await page.request.post('/api/v1/flashcards', {
      data: {
        deckId: deck.data.id,
        front: `STU-01 front ${index}`,
        back: `STU-01 back ${index}`,
      },
    });
    expect(cardResponse.status(), `POST /api/v1/flashcards (card ${index})`).toBe(201);
    cardIds.push(((await cardResponse.json()) as { data: { id: string } }).data.id);
  }

  for (const cardId of cardIds) {
    const practiceResponse = await page.request.post(`/api/v1/flashcards/${cardId}/practice`, {
      data: { wasCorrect: true, confidenceLevel: 4 },
    });
    expect(practiceResponse.status(), `POST /api/v1/flashcards/${cardId}/practice`).toBe(201);
  }

  return cardIds;
}

/** Move only this test's review states into the past (the documented time exception). */
async function makeDue(cardIds: string[]): Promise<void> {
  const db = createQaSupabase();
  const aged = await db
    .from('flashcard_review_state')
    .update({ next_review_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() })
    .in('flashcard_id', cardIds)
    .select('flashcard_id');

  expect(aged.error, 'backdate the review states this spec just created').toBeNull();
  expect(aged.data, 'only the cards created by this spec were aged').toHaveLength(cardIds.length);
}

test.describe('STU-01 — student dashboard', () => {
  test('greets the student, renders real stats and inflects the due count', async ({ page }) => {
    test.setTimeout(90_000);

    const tenant = await signInAsStudent(page);
    await page.goto('/app');
    await expect(page).toHaveURL(/\/app$/);

    // --- Step 2: date header, greeting, stat cards -----------------------
    // Rendered as „środa, 28 października”; the uppercase look is CSS only, so
    // the DOM text is matched case-insensitively.
    const dateHeader = page.locator('p').filter({
      hasText: /^\p{L}+, \d{1,2} \p{L}+$/iu,
    });
    await expect(dateHeader, 'Polish date header').toHaveCount(1);
    await expect(dateHeader).toBeVisible();

    const me = await page.request.get('/api/v1/auth/me');
    expect(me.status(), 'GET /api/v1/auth/me').toBe(200);
    const name = ((await me.json()) as { data: { user: { user_metadata: { name: string } } } }).data
      .user.user_metadata.name;
    const firstName = name.split(' ')[0];
    await expect(
      page.getByRole('heading', { level: 1 }),
      'greeting uses the first name only',
    ).toHaveText(`Cześć, ${firstName}.`);

    for (const title of Object.values(STAT_CARDS)) {
      await expect(statCard(page, title), 'stat title').toBeVisible();
    }

    // The fresh tenant has no practice and no quiz attempts.
    await expect(page.getByText(dueSentence(0, 'fiszek'))).toBeVisible();
    await expect(statValue(page, STAT_CARDS.practiced)).toHaveText('0');
    await expect(statValue(page, STAT_CARDS.average)).toHaveText('—');
    await expect(statValue(page, STAT_CARDS.quizzes)).toHaveText('0');
    await expect(statValue(page, STAT_CARDS.accuracy)).toHaveText('0%');

    const freshBody = await page.locator('body').innerText();
    expect(freshBody, 'the dashboard must not print NaN/undefined').not.toMatch(
      /\b(?:NaN|undefined)\b/,
    );

    // --- Due count: 1 fiszkę / 2 fiszki / 5 fiszek -----------------------
    const cardIds = await createPracticedCards(page, tenant);

    await makeDue(cardIds.slice(0, 1));
    await page.reload();
    await expect(page.getByText(dueSentence(1, 'fiszkę'))).toBeVisible();

    await makeDue(cardIds.slice(1, 2));
    await page.reload();
    await expect(page.getByText(dueSentence(2, 'fiszki'))).toBeVisible();

    await makeDue(cardIds.slice(2));
    await page.reload();
    await expect(page.getByText(dueSentence(5, 'fiszek'))).toBeVisible();

    await expect(statValue(page, STAT_CARDS.practiced)).toHaveText('5');
    await expect(statValue(page, STAT_CARDS.average)).toHaveText('—');
    await expect(statValue(page, STAT_CARDS.quizzes)).toHaveText('0');
    await expect(statValue(page, STAT_CARDS.accuracy)).toHaveText('100%');

    const loadedBody = await page.locator('body').innerText();
    expect(loadedBody, 'the loaded dashboard must not print NaN/undefined').not.toMatch(
      /\b(?:NaN|undefined)\b/,
    );

    // --- Step 3: both shortcuts ------------------------------------------
    await page.getByRole('button', { name: 'Kontynuuj przegląd' }).click();
    await expect(page).toHaveURL(/\/app\/study\/learn$/, { timeout: 15_000 });

    await page.goto('/app');
    await page.getByRole('button', { name: 'Utwórz talię' }).click();
    await expect(page).toHaveURL(/\/app\/flashcards$/, { timeout: 15_000 });
  });

  test('shows a loading placeholder in every stat card before the numbers arrive', async ({
    page,
  }) => {
    test.setTimeout(60_000);

    await signInAsStudent(page);

    // Hold the stats response so the first paint is deterministically the
    // loading state; the overview/assignments calls are unaffected.
    let releaseStats!: () => void;
    const statsGate = new Promise<void>((resolve) => {
      releaseStats = resolve;
    });
    await page.route('**/api/v1/stats/student', async (route) => {
      await statsGate;
      await route.continue();
    });

    await page.goto('/app');
    await expect(page).toHaveURL(/\/app$/);

    for (const title of Object.values(STAT_CARDS)) {
      const card = statCard(page, title);
      await expect(card, 'stat card is rendered while loading').toBeVisible();
      // StatCard renders its "…" value as a pulsing skeleton placeholder.
      await expect(card.locator('.animate-pulse'), 'loading placeholder').toBeVisible();
    }

    releaseStats();

    await expect(statValue(page, STAT_CARDS.practiced)).toHaveText(/^\d+$/);
    await expect(statValue(page, STAT_CARDS.average)).toHaveText(/^(?:—|\d+%)$/);
    await expect(statValue(page, STAT_CARDS.quizzes)).toHaveText(/^\d+$/);
    await expect(statValue(page, STAT_CARDS.accuracy)).toHaveText(/^\d+%$/);

    const body = await page.locator('body').innerText();
    expect(body, 'the loaded dashboard must not print NaN/undefined').not.toMatch(
      /\b(?:NaN|undefined)\b/,
    );
  });
});
