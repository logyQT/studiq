import { expect, test, type Page } from '@playwright/test';
import { asJson, json } from '#test/helpers/json';
import { createQaSupabase } from '#test/helpers/db-admin';
import { loadTenant, loginAs, tenantUser } from '#test/qa/fixtures/tenant';

/**
 * STU-55 — positive control for the `stats.insights` gate (ADR-0015 §7, phase
 * 5d, R39): a student whose **personal** plan is the paid `ace` (Pro) resolves
 * `stats.insights` inside a free `launch` org (the key is `personalPortable`,
 * D3), so the diagnostic reads answer 200 and the cards render — no plan card.
 *
 * Case: `qa/cases/STU-55.md`.
 *
 * Tenant (deterministic `content` profile, free `launch` org — the DB default;
 * one fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts STU-55 --fresh
 *
 * The spec moves the tenant student's `profiles.personal_plan_key` to `ace`
 * through the service-role client (the SEC-07 `finally`-restore pattern) and
 * restores the seeded plan in `finally`, so a CI retry on the same tenant
 * starts clean. Nothing shared is read or written beyond that one tenant row.
 *
 * Acceptance points:
 * 1. `GET /api/v1/me/entitlements` as the student contains `stats.insights`.
 * 2. `GET /api/v1/stats/weak-points` → 200 and `GET
 *    /api/v1/stats/student/insights?days=30` → 200 (no 403).
 * 3. `/app/stats/activity` shows the weak-points cards **without** the plan
 *    card; `/app/stats/content` renders the retention card body and
 *    `/app/stats/results` the mastery card body — no „Analizy i słabe punkty”
 *    lock anywhere on the three pages.
 *
 * Mutation (proves this spec can fail): delete the
 * `await requireEntitlement(ctx, 'stats.insights')` line from
 * `StudentInsightsController.getInsights` — step 2's second assertion is then
 * green on a build that refuses nobody, and the STU-54 spec is the one that
 * goes red; conversely a build whose resolver never makes the key effective
 * (e.g. the flag row missing) fails this spec's step 1, so the case cannot
 * pass on an empty resolution either.
 */

const CASE = 'STU-55';

const WEAK_POINTS = '/api/v1/stats/weak-points';
const INSIGHTS = '/api/v1/stats/student/insights?days=30';

/** Polish copy from `AppStatsPage` / `StudentInsights` (pl.json), as the UI renders it. */
const COPY = {
  weakDecks: 'Najsłabsze talie',
  weakTopics: 'Najsłabsze tematy',
  lockedTitle: 'Analizy i słabe punkty',
  retentionTitle: 'Krzywa zapamiętywania',
  masteryTitle: 'Opanowanie tematów',
} as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: string;
}

async function getData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  const body = await json<ApiEnvelope<T>>(response);
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data;
}

test.describe('@case:STU-55 @area:STU @prio:P2 paid personal plan unlocks the student insights', () => {
  test('the Pro personal plan resolves stats.insights inside the launch org and the cards render', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    const student = tenantUser(tenant, 'student');

    // Evidence for a failing run: the deterministic tenant this run owns.
    console.log(`STU-55 tenant key: ${tenant.key} (student ${student.email})`);

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const db = createQaSupabase();

    // --- Prerequisite: the student's own personal plan is the paid `ace` -----
    // Same shape as SEC-07's positive control: read, set, restore in `finally`.
    const originalPlanRow = await db
      .from('profiles')
      .select('personal_plan_key')
      .eq('id', student.id)
      .maybeSingle();
    expect(originalPlanRow.error, 'reading the tenant student’s personal plan').toBeNull();
    const originalPlan = asJson<string | null>(originalPlanRow.data?.personal_plan_key) ?? 'base';

    try {
      const setup = await db
        .from('profiles')
        .update({ personal_plan_key: 'ace' })
        .eq('id', student.id);
      expect(setup.error, 'move the tenant student to the paid Pro plan').toBeNull();

      await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });

      // --- Step 1: the entitlement resolves through the personal plan --------
      const entitlements = await getData<{ entitlements: string[] }>(
        page,
        '/api/v1/me/entitlements',
      );
      expect(
        entitlements.entitlements,
        'the Pro personal plan resolves stats.insights inside the launch org (D3)',
      ).toContain('stats.insights');

      // --- Step 2: the gated reads answer 200, not 403 ------------------------
      const weakPoints = await page.request.get(WEAK_POINTS);
      expect(weakPoints.status(), `GET ${WEAK_POINTS} as the student on Pro`).toBe(200);
      const insights = await page.request.get(INSIGHTS);
      expect(insights.status(), `GET ${INSIGHTS} as the student on Pro`).toBe(200);

      // --- Step 3: the diagnostic cards render without the plan card ----------
      await page.goto('/app/stats/activity');
      await expect(page).toHaveURL(/\/app\/stats\/activity$/);
      await expect(page.getByText(COPY.weakDecks, { exact: true })).toBeVisible();
      await expect(page.getByText(COPY.weakTopics, { exact: true })).toBeVisible();
      await expect(
        page.getByText(COPY.lockedTitle, { exact: true }),
        'no plan card on the activity page',
      ).toHaveCount(0);

      await page.goto('/app/stats/content');
      await expect(page).toHaveURL(/\/app\/stats\/content$/);
      await expect(page.getByText(COPY.retentionTitle, { exact: true })).toBeVisible();
      await expect(
        page.getByText(COPY.lockedTitle, { exact: true }),
        'no plan card on the content page',
      ).toHaveCount(0);

      await page.goto('/app/stats/results');
      await expect(page).toHaveURL(/\/app\/stats\/results$/);
      await expect(page.getByText(COPY.masteryTitle, { exact: true })).toBeVisible();
      await expect(
        page.getByText(COPY.lockedTitle, { exact: true }),
        'no plan card on the results page',
      ).toHaveCount(0);

      expect(pageErrors, 'no browser console errors during the walk').toEqual([]);
    } finally {
      const restore = await db
        .from('profiles')
        .update({ personal_plan_key: originalPlan })
        .eq('id', student.id);
      expect(restore.error, 'restore the tenant student’s seeded personal plan').toBeNull();
    }
  });
});
