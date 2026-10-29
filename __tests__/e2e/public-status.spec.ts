import { expect, test, type Page } from '@playwright/test';
import { t } from '#test/e2e/utils';

const title = t('StatusPage.title');
const operational = t('StatusPage.operational');
const problem = t('StatusPage.problem');
const unavailable = t('StatusPage.unavailable');
const lastChecked = t('StatusPage.last_checked');

const HEALTH_URL = '**/api/v1/health';

/**
 * #634 added two app-wide polite live regions (`role="status"`): the locale
 * announcer in the root layout and the theme switch inside the footer. Scope
 * the locator to the page's own status region so they cannot collide with it.
 */
const statusRegion = (page: Page) => page.getByRole('main').getByRole('status');

function healthBody(
  status: 'healthy' | 'degraded' | 'unhealthy',
  timestamp = new Date().toISOString(),
) {
  return {
    success: true,
    data: {
      status,
      timestamp,
      uptime: 123,
      environment: 'test',
      services: { supabase: status === 'unhealthy' ? 'down' : 'up' },
      responseTime: 5,
    },
  };
}

/**
 * #284 — /status is public by design (no RouteRule): these tests never sign in.
 * The health endpoint is stubbed so each state is deterministic and independent
 * of the local Supabase instance.
 */
test.describe('Public status page', () => {
  test('shows a readable operational state without a session', async ({ page }) => {
    await page.route(HEALTH_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(healthBody('healthy')),
      }),
    );

    await page.goto('/status');

    await expect(page.getByRole('heading', { level: 1 })).toContainText(title);
    const status = statusRegion(page);
    await expect(status).toContainText(operational);
    await expect(page.getByText(lastChecked)).toBeVisible();
  });

  test('shows a problem state when the check reports degraded (HTTP 200)', async ({ page }) => {
    await page.route(HEALTH_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(healthBody('degraded')),
      }),
    );

    await page.goto('/status');

    const status = statusRegion(page);
    await expect(status).toContainText(problem);
    await expect(status).not.toContainText(operational);
  });

  test('shows a problem state when the check reports unhealthy (HTTP 503)', async ({ page }) => {
    await page.route(HEALTH_URL, (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify(healthBody('unhealthy')),
      }),
    );

    await page.goto('/status');

    const status = statusRegion(page);
    await expect(status).toContainText(problem);
    await expect(status).not.toContainText(unavailable);
  });

  test('shows an unavailable state when the request fails', async ({ page }) => {
    await page.route(HEALTH_URL, (route) => route.abort());

    await page.goto('/status');

    await expect(statusRegion(page)).toContainText(unavailable);
  });

  /**
   * #284 review 1 — TanStack Query keeps the previous `data` when a background
   * refetch fails, so the page must derive its state from `error` first. The old
   * response uses a fixed past timestamp so the failure time cannot format to the
   * same minute-precision string.
   */
  test('a failed background refetch replaces the stale operational state', async ({ page }) => {
    let mode: 'healthy' | 'unhealthy' | 'abort' = 'healthy';

    await page.route(HEALTH_URL, (route) => {
      if (mode === 'abort') return route.abort();

      return route.fulfill({
        status: mode === 'healthy' ? 200 : 503,
        contentType: 'application/json',
        body: JSON.stringify(
          healthBody(mode === 'healthy' ? 'healthy' : 'unhealthy', '2026-01-01T09:00:00.000Z'),
        ),
      });
    });

    await page.goto('/status');

    const status = statusRegion(page);
    await expect(status).toContainText(operational);

    const checkedLine = page.getByText(lastChecked);
    const firstChecked = await checkedLine.textContent();
    expect(firstChecked).toBeTruthy();

    mode = 'unhealthy';
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));

    await expect(status).toContainText(problem);
    await expect(status).not.toContainText(operational);
    await expect(checkedLine).not.toHaveText(firstChecked as string);
  });

  test('a broken background refetch replaces the stale operational state', async ({ page }) => {
    let mode: 'healthy' | 'abort' = 'healthy';

    await page.route(HEALTH_URL, (route) => {
      if (mode === 'abort') return route.abort();

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(healthBody('healthy', '2026-01-01T09:00:00.000Z')),
      });
    });

    await page.goto('/status');

    await expect(statusRegion(page)).toContainText(operational);

    const checkedLine = page.getByText(lastChecked);
    const firstChecked = await checkedLine.textContent();
    expect(firstChecked).toBeTruthy();

    mode = 'abort';
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));

    await expect(statusRegion(page)).toContainText(unavailable);
    await expect(statusRegion(page)).not.toContainText(operational);
    await expect(checkedLine).not.toHaveText(firstChecked as string);
  });

  test('the 404 page status button opens the readable status page', async ({ page }) => {
    await page.route(HEALTH_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(healthBody('healthy')),
      }),
    );

    await page.goto('/nie-ma-takiej-strony');
    await page.getByRole('link', { name: t('NotFoundPage.system_status') }).click();

    await expect(page).toHaveURL(/\/status$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(title);
    // The page is rendered, not the raw JSON document the API returns.
    await expect(statusRegion(page)).toContainText(operational);
  });
});
