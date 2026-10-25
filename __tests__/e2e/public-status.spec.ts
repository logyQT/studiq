import { expect, test } from '@playwright/test';
import { t } from '#test/e2e/utils';

const title = t('StatusPage.title');
const operational = t('StatusPage.operational');
const problem = t('StatusPage.problem');
const unavailable = t('StatusPage.unavailable');
const lastChecked = t('StatusPage.last_checked');

const HEALTH_URL = '**/api/v1/health';

function healthBody(status: 'healthy' | 'degraded' | 'unhealthy') {
  return {
    success: true,
    data: {
      status,
      timestamp: new Date().toISOString(),
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
    const status = page.getByRole('status');
    await expect(status).toContainText(operational);
    await expect(page.getByText(lastChecked)).toBeVisible();
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

    const status = page.getByRole('status');
    await expect(status).toContainText(problem);
    await expect(status).not.toContainText(unavailable);
  });

  test('shows an unavailable state when the request fails', async ({ page }) => {
    await page.route(HEALTH_URL, (route) => route.abort());

    await page.goto('/status');

    await expect(page.getByRole('status')).toContainText(unavailable);
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
    await expect(page.getByRole('status')).toContainText(operational);
  });
});
