import { expect, test, type Page } from '@playwright/test';
import { json } from '#test/helpers/json';
import { loadTenant, loginAs, tenantUser } from '#test/qa/fixtures/tenant';

/**
 * STU-54 — the diagnostic stats are gated on `stats.insights` (ADR-0015 §7,
 * phase 5d): a student in a free `launch` org (personal `base`) gets the
 * descriptive cards on /app/stats/activity and the plan card in place of the
 * weak-points/insights/retention/mastery reads, which answer 403.
 *
 * Case: `qa/cases/STU-54.md`.
 *
 * Tenant (deterministic `content` profile, free `launch` org — the DB default,
 * no `--plan` override; one fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts STU-54 --fresh
 *
 * gives the org `qa-stu-54-<suffix>` with a manager, a teacher and a student;
 * the spec logs in as `tenant.users.student`. Nothing shared is read or
 * written: no admin setting, feature flag, plan, platform stat or singleton
 * row, and no other tenant.
 *
 * Acceptance points:
 * 1. `GET /api/v1/features/me` as the student does not contain `stats.insights`
 *    (the 403s below are the entitlement gate, not a persona rule).
 * 2. `/app/stats/activity` renders the descriptive stat cards („Powtórki w tym
 *    tygodniu”, „Poprawne”, „Do powtórki dziś”) and the daily-activity card, and
 *    the weak-points cards show the plan card („Analizy i słabe punkty” +
 *    „Zobacz plany”) instead of the lists.
 * 3. `GET /api/v1/stats/weak-points` → 403 `FORBIDDEN` and
 *    `GET /api/v1/stats/student/insights?days=30` → 403 `FORBIDDEN`, both with
 *    `x-error-code: FORBIDDEN`.
 * 4. `/app/stats/content` and `/app/stats/results` show the plan card instead of
 *    the retention / topic-mastery cards.
 *
 * Mutation (proves this spec can fail): delete the
 * `await requireEntitlement(ctx, 'stats.insights')` line from
 * `StatsController.getWeakPoints` — step 3's first assertion then answers 200,
 * so the spec goes red.
 */

const CASE = 'STU-54';

const WEAK_POINTS = '/api/v1/stats/weak-points';
const INSIGHTS = '/api/v1/stats/student/insights?days=30';

/** Polish copy from `AppStatsPage` / `StudentInsights` (pl.json), as the UI renders it. */
const COPY = {
  reviewsThisWeek: 'Powtórki w tym tygodniu',
  correct: 'Poprawne',
  dueToday: 'Do powtórki dziś',
  dailyActivity: 'Aktywność dzienna',
  weakDecks: 'Najsłabsze talie',
  weakTopics: 'Najsłabsze tematy',
  lockedTitle: 'Analizy i słabe punkty',
  lockedCta: 'Zobacz plany',
  retentionTitle: 'Krzywa zapamiętywania',
  masteryTitle: 'Opanowanie tematów',
} as const;

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

async function expectForbidden(page: Page, url: string): Promise<void> {
  const response = await page.request.get(url);
  const body = await json<ApiEnvelope<unknown>>(response);
  expect(response.status(), `GET ${url} → ${response.status()} ${JSON.stringify(body)}`).toBe(403);
  expect(response.headers()['x-error-code'], `GET ${url} x-error-code`).toBe('FORBIDDEN');
  expect(body, `GET ${url} envelope`).toEqual({ success: false, error: 'FORBIDDEN' });
}

/**
 * A StatCard title (`<p class="…uppercase…">`). Scoped to `p` because the
 * state-breakdown legend renders the same word ("Poprawne") in a `div` once the
 * chart data loads — the page text alone is ambiguous.
 */
function statCardTitle(page: Page, title: string) {
  return page.locator('p').filter({ hasText: new RegExp(`^${title}$`) });
}

test.describe('@case:STU-54 @area:STU @prio:P2 free student sees descriptive stats and the insights plan card', () => {
  test('the weak-points/insights reads are 403 and the diagnostic cards are plan cards', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    const student = tenantUser(tenant, 'student');

    // Evidence for a failing run: the deterministic tenant this run owns.
    console.log(`STU-54 tenant key: ${tenant.key} (student ${student.email})`);

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });

    // --- Precondition: the entitlement, not the persona, is the reason ------
    const featuresResponse = await page.request.get('/api/v1/features/me');
    expect(featuresResponse.status(), 'GET /api/v1/features/me as the student').toBe(200);
    const features = await json<ApiEnvelope<{ features: string[] }>>(featuresResponse);
    expect(
      features.data.features,
      'launch org + base personal plan resolve no stats.insights',
    ).not.toContain('stats.insights');

    // --- Step 1: the descriptive cards render, the weak points are locked ----
    await page.goto('/app/stats/activity');
    await expect(page).toHaveURL(/\/app\/stats\/activity$/);
    await expect(statCardTitle(page, COPY.reviewsThisWeek)).toBeVisible();
    await expect(statCardTitle(page, COPY.correct)).toBeVisible();
    await expect(statCardTitle(page, COPY.dueToday)).toBeVisible();
    await expect(page.getByText(COPY.dailyActivity, { exact: true })).toBeVisible();
    await expect(page.getByText(COPY.weakDecks, { exact: true })).toBeVisible();
    await expect(page.getByText(COPY.weakTopics, { exact: true })).toBeVisible();
    // Every diagnostic card on the page carries the plan card (weak decks, weak
    // topics and study time), no list.
    await expect(
      page.getByText(COPY.lockedTitle, { exact: true }),
      'all three diagnostic cards (weak decks, weak topics, study time) show the plan card',
    ).toHaveCount(3);
    await expect(
      page.getByRole('button', { name: COPY.lockedCta, exact: true }).first(),
    ).toBeVisible();

    // --- Step 2: the gated reads answer 403 ----------------------------------
    await expectForbidden(page, WEAK_POINTS);
    await expectForbidden(page, INSIGHTS);

    // --- Step 3: the retention / mastery cards are plan cards too ------------
    await page.goto('/app/stats/content');
    await expect(page).toHaveURL(/\/app\/stats\/content$/);
    await expect(page.getByText(COPY.retentionTitle, { exact: true })).toBeVisible();
    await expect(page.getByText(COPY.lockedTitle, { exact: true })).toBeVisible();

    await page.goto('/app/stats/results');
    await expect(page).toHaveURL(/\/app\/stats\/results$/);
    await expect(page.getByText(COPY.masteryTitle, { exact: true })).toBeVisible();
    await expect(page.getByText(COPY.lockedTitle, { exact: true })).toBeVisible();

    expect(pageErrors, 'no browser console errors during the walk').toEqual([]);
  });
});
