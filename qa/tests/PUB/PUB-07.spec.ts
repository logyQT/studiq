import { expect, test, type Page } from '@playwright/test';

/**
 * PUB-07 — public 404 page, signed out (`qa/cases/PUB-07.md`).
 *
 * The case is tenant-free: its prerequisite is "Brak sesji" and the surface is
 * a public route, so there is no tenant graph to seed. Isolation comes from a
 * fresh browser context per test and a pinned locale — nothing shared (session,
 * locale cookie default, DB rows) is read or written.
 */
const NOT_FOUND_PATH = '/nie-ma-takiej-strony';
const FALLBACK_APP_URL = 'http://localhost:3010';

async function openNotFound(page: Page) {
  const response = await page.goto(NOT_FOUND_PATH);
  expect(response, `no document response for ${NOT_FOUND_PATH}`).not.toBeNull();
  return response!;
}

test.beforeEach(async ({ context, baseURL }) => {
  // next-intl resolves the locale from NEXT_LOCALE; the case quotes the Polish
  // copy, so pin it instead of inheriting whatever cookie an earlier run left.
  await context.addCookies([
    { name: 'NEXT_LOCALE', value: 'pl', url: baseURL ?? FALLBACK_APP_URL },
  ]);
});

test('serves the Polish 404 page with a real 404 response', async ({ page }) => {
  const response = await openNotFound(page);

  expect(response.status()).toBe(404);
  await expect(page).toHaveURL(/\/nie-ma-takiej-strony$/);

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('404');
  await expect(page.getByRole('heading', { name: 'Nie znaleziono strony' })).toBeVisible();
  await expect(
    page.getByText(
      'Przepraszamy, nie możemy znaleźć strony, której szukasz. Mogła zostać przeniesiona lub usunięta.',
    ),
  ).toBeVisible();

  await expect(page.getByRole('link', { name: 'Wróć do strony głównej' })).toHaveAttribute(
    'href',
    '/',
  );
  await expect(page.getByRole('link', { name: 'Sprawdź status systemu' })).toHaveAttribute(
    'href',
    '/status',
  );
});

test('"Wróć do strony głównej" returns to the landing page', async ({ page }) => {
  await openNotFound(page);

  await page.getByRole('link', { name: 'Wróć do strony głównej' }).click();

  await expect(page).toHaveURL((url) => url.pathname === '/');
  await expect(page.getByRole('heading', { name: 'Nie znaleziono strony' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Logowanie' })).toBeVisible();
});

test('"Sprawdź status systemu" opens the public system-status page', async ({ page }) => {
  // The link only has to reach a working status page; stub the health check so the
  // rendered state is deterministic instead of tracking the shared environment.
  await page.route('**/api/v1/health', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          uptime: 1,
          environment: 'test',
          services: { supabase: 'up' },
          responseTime: 1,
        },
      }),
    }),
  );

  await openNotFound(page);

  await page.getByRole('link', { name: 'Sprawdź status systemu' }).click();

  await expect(page).toHaveURL((url) => url.pathname === '/status');
  await expect(page.getByRole('heading', { level: 1, name: 'Status systemu' })).toBeVisible();
  // The page renders the human-readable state, not the raw API document.
  await expect(page.getByRole('status')).toContainText('Działa');
});
