import { expect, test } from '@playwright/test';
import { t } from '#test/e2e/utils';

const email = 'student1@dev.local';
const password = 'pass';

const STATES_URL = '/api/v1/flashcards/practice/states';

interface StateBreakdown {
  totalCards: number;
  neverPracticed: number;
  learning: number;
  review: number;
  relearning: number;
  leeched: number;
}

async function loginStudent(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel(t('LoginPage.email_label')).fill(email);
  await page.getByLabel(t('LoginPage.password_label')).fill(password);
  await page.getByRole('button', { name: t('LoginPage.login_button') }).click();
  await page.waitForURL(/\/app/);
}

/**
 * `[data-slot="card"]` holding the „Podział stanów” title.
 */
function stateBreakdownCard(page: import('@playwright/test').Page) {
  return page
    .locator('[data-slot="card"]', { has: page.getByText(t('AppStatsPage.state_breakdown')) })
    .first();
}

/**
 * The pie lives in the chart's `<svg class="recharts-surface">`. Select it through the
 * pie itself: a Recharts `<Legend>` also renders a small `recharts-surface` icon, and the
 * guard below must measure the chart, not the legend bullet.
 */
function donutSurface(card: import('@playwright/test').Locator) {
  return card.locator('svg.recharts-surface:has(.recharts-pie)');
}

/**
 * The card used to be a flex item in a centring row whose width came from a percentage
 * child, so Recharts measured 0 px and rendered nothing (#384). Assert the surface is
 * actually measurable, retrying because a range click re-renders the tab.
 */
async function expectDonutSurface(card: import('@playwright/test').Locator) {
  await expect(async () => {
    const surface = donutSurface(card);
    await expect(surface).toHaveCount(1);
    const box = await surface.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.width ?? 0).toBeGreaterThan(100);
    expect(box?.height ?? 0).toBeGreaterThan(100);
  }).toPass();
}

test.describe('Student stats activity — state breakdown (#384)', () => {
  test('renders the state breakdown donut in every range and after a reload', async ({ page }) => {
    await loginStudent(page);

    // Read the live breakdown instead of hard-coding seed numbers, so the legend
    // assertions stay valid when the seed changes.
    const statesResponse = await page.request.get(STATES_URL);
    expect(statesResponse.status()).toBe(200);
    const states = ((await statesResponse.json()) as { data: StateBreakdown }).data;

    const nonZeroStates = [
      { count: states.neverPracticed, label: 'state_new' },
      { count: states.learning, label: 'state_learning' },
      { count: states.review, label: 'state_review' },
      { count: states.relearning, label: 'state_relearning' },
      { count: states.leeched, label: 'state_leech' },
    ].filter((state) => state.count > 0);
    expect(nonZeroStates.length).toBeGreaterThan(0);

    await page.goto('/app/stats/activity');

    const card = stateBreakdownCard(page);
    await expect(card).toBeVisible();
    await expectDonutSurface(card);
    await expect(card.locator('.recharts-pie')).toHaveCount(1);

    for (const state of nonZeroStates) {
      await expect(card.getByText(t(`AppStatsPage.${state.label}`))).toBeVisible();
    }

    for (const range of ['range_7d', 'range_30d', 'range_1y']) {
      // whole name only: the study-time card has its own "Last 7 days" range buttons on this page
      const whole = new RegExp('^(?:' + t(`AppStatsPage.${range}`).source + ')$', 'i');
      await page.getByRole('button', { name: whole }).click();
      await expect(card).toBeVisible();
      await expectDonutSurface(card);
      await expect(card.locator('.recharts-pie')).toHaveCount(1);
    }

    // The issue was reproduced "after full reloads".
    await page.reload();
    await expect(card).toBeVisible();
    await expectDonutSurface(card);
    await expect(card.locator('.recharts-pie')).toHaveCount(1);

    for (const state of nonZeroStates) {
      await expect(card.getByText(t(`AppStatsPage.${state.label}`))).toBeVisible();
    }
  });

  test('shows the empty-state sentence when the account has no cards', async ({ page }) => {
    await loginStudent(page);

    // Pin the endpoint to an all-zero breakdown: no account in the seed is guaranteed
    // to have zero cards, and an empty card must never be silently blank.
    await page.route(`**${STATES_URL}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            totalCards: 0,
            neverPracticed: 0,
            learning: 0,
            review: 0,
            relearning: 0,
            leeched: 0,
          },
        }),
      }),
    );

    await page.goto('/app/stats/activity');

    const card = stateBreakdownCard(page);
    await expect(card.getByText(t('AppStatsPage.state_breakdown_empty'))).toBeVisible();
    await expect(card.locator('.recharts-surface')).toHaveCount(0);
  });
});
