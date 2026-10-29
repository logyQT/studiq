import { expect, test, type Page } from '@playwright/test';

/**
 * PUB-07 — Strona 404 (niezalogowany).
 *
 * Prerequisite "Brak sesji": the spec starts from an empty storage state and
 * never signs in. The case's deterministic tenant
 * (`qa/cases/PUB-07.md::PUB-07::qa-shared`, seeded with
 * `bun scripts/qa-tenant.ts PUB-07 --fresh`) exists for bookkeeping only — a 404
 * page has no tenant input, so the spec reads no user, org or content id and can
 * never disturb another worker's tenant.
 *
 * The 404 copy is the anonymous visitor's, so the browser context pins
 * `NEXT_LOCALE=pl` instead of inheriting whichever language the shared profile
 * last selected. The only other input is the (read-only) health endpoint behind
 * the "Sprawdź status systemu" destination; the spec asserts the destination
 * renders, never the status value.
 */

const UNKNOWN_PATH = '/nie-ma-takiej-strony';
const NESTED_UNKNOWN_PATH = '/nie-ma-takiej-strony/podstrona';

const NOT_FOUND_TITLE = 'Nie znaleziono strony';
const BACK_HOME = 'Wróć do strony głównej';
const SYSTEM_STATUS = 'Sprawdź status systemu';
const STATUS_TITLE = 'Status systemu';

/** A visit to an unknown URL, as a visitor without a session makes it. */
async function expectNotFoundPage(page: Page): Promise<void> {
  await expect(
    page.getByRole('heading', { level: 2, name: NOT_FOUND_TITLE, exact: true }),
  ).toBeVisible();

  // "…z opisem": the title is followed by a readable explanation, not a bare code.
  const description = page
    .getByRole('heading', { level: 2, name: NOT_FOUND_TITLE, exact: true })
    .locator('..')
    .locator('p');
  await expect(description).toHaveCount(1);
  const text = (await description.innerText()).trim();
  expect(text.length, '404 description copy').toBeGreaterThan(40);

  // Both entries of the case, with their intended destinations.
  await expect(page.getByRole('link', { name: BACK_HOME, exact: true })).toHaveAttribute(
    'href',
    '/',
  );
  await expect(page.getByRole('link', { name: SYSTEM_STATUS, exact: true })).toHaveAttribute(
    'href',
    '/status',
  );
}

/** No session: the public 404 page must not need one. */
async function expectNoSession(page: Page): Promise<void> {
  const me = await page.request.get('/api/v1/auth/me');
  expect(me.status(), 'session probe').toBe(200);
  const body = (await me.json()) as { data?: { user?: unknown } };
  expect(body.data?.user ?? null).toBeNull();
}

test.describe('@case:PUB-07 @area:PUB @prio:P2 public 404 page', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ context, baseURL }) => {
    // A returning Polish visitor: pin the app's default locale so a stale
    // profile cookie can never switch the copy under the assertions.
    const { hostname } = new URL(baseURL!);
    await context.addCookies([{ name: 'NEXT_LOCALE', value: 'pl', domain: hostname, path: '/' }]);
  });

  test('an unknown URL shows the 404 page and both links reach their pages', async ({
    page,
    baseURL,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const failedResponses: { status: number; path: string }[] = [];

    // The missing documents are the point of the case; the browser logs each of
    // them as a failed resource. Everything else must load cleanly.
    const expectedMiss = /Failed to load resource: the server responded with a status of 404/;

    page.on('console', (message) => {
      if (message.type() === 'error' && !expectedMiss.test(message.text())) {
        consoleErrors.push(message.text());
      }
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('response', (response) => {
      if (response.status() >= 400) {
        failedResponses.push({ status: response.status(), path: new URL(response.url()).pathname });
      }
    });

    // Step 1: open a URL that has no route. The missing document is the one
    // expected 404 — everything else the page loads must succeed.
    const response = await page.goto(UNKNOWN_PATH);
    expect(response?.status(), 'missing document status').toBe(404);
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
    await expectNotFoundPage(page);
    await expectNoSession(page);

    // Step 2a: "Sprawdź status systemu" is a real link to the status page.
    await page.getByRole('link', { name: SYSTEM_STATUS, exact: true }).click();
    await expect(page).toHaveURL(/\/status$/);
    await expect(
      page.getByRole('heading', { level: 1, name: STATUS_TITLE, exact: true }),
    ).toBeVisible();

    // Step 2b: "Wróć do strony głównej" returns to "/", not to browser history.
    await page.goto(UNKNOWN_PATH);
    await expectNotFoundPage(page);
    await page.getByRole('link', { name: BACK_HOME, exact: true }).click();
    await expect(page).toHaveURL(`${baseURL}/`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: NOT_FOUND_TITLE, exact: true }),
    ).toHaveCount(0);

    // Adjacent regression: deeper unknown paths must render the same 404 page
    // (and a 404 status), not a 200 shell or an error boundary.
    const nested = await page.goto(NESTED_UNKNOWN_PATH);
    expect(nested?.status(), 'nested missing document status').toBe(404);
    await expectNotFoundPage(page);

    expect(pageErrors, 'uncaught page errors').toEqual([]);
    expect(consoleErrors, 'console errors').toEqual([]);
    expect(
      failedResponses.filter(
        (failed) =>
          failed.status !== 404 ||
          (failed.path !== UNKNOWN_PATH && failed.path !== NESTED_UNKNOWN_PATH),
      ),
      'HTTP failures beyond the requested missing documents',
    ).toEqual([]);
    expect(
      failedResponses.filter((failed) => failed.status === 404).length,
      'every missing document answered 404',
    ).toBe(3);
  });
});
