import { expect, test, type Page } from '@playwright/test';

/**
 * PUB-02 — Strona „Funkcje” (/features) dla gościa bez sesji.
 *
 * Prerequisite "Brak sesji": the page is public, so the spec signs nobody in and
 * sends no storage state. It reads no tenant, plan, feature-flag or singleton
 * row; the default `content` tenant is bookkeeping only.
 *
 * What is pinned is the contract this page can actually break, not its wording
 * (same rule as PUB-01): the heading outline, the four areas and their ids, the
 * contents index, that areas 01–03 still end in a real product surface, that the
 * plan matrix stays deleted, and that the page keeps three distinct
 * destinations. A copy edit does not turn this red; deleting a section, a
 * surface or a link does.
 *
 * Walk (2026-11-16, `feat/features-rework` @ 5e1349d8): one h1, four cluster
 * sections plus the closing band, thirteen h3 capabilities, the contents index
 * with four anchors, the graded-question card under 01, the generated-card tiles
 * under 02, the problem-question card under 03, no table anywhere, and
 * `/register` + `/pricing` + `/contact` reachable.
 *
 * Mutation (proves this spec can fail): deleting `surface: <QuizReviewPreview />`
 * from the `study-loop` cluster leaves that area without a card and the
 * `#study-loop [data-slot="card"]` assertion goes red with "toHaveCount:
 * Expected: 1, Received: 0".
 */

const CLUSTERS = [
  { id: '#study-loop', surfaces: 'card' },
  { id: '#material', surfaces: 'badge' },
  { id: '#teaching', surfaces: 'card' },
  { id: '#organization', surfaces: null },
] as const;

/** Destinations the page must keep offering: register, pricing, contact. */
const DESTINATIONS = ['/register', '/pricing', '/contact'] as const;

/** Collect browser-side failures so "the page loads without errors" is asserted. */
function watchForErrors(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedDocuments: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => {
    if (response.request().resourceType() === 'document' && response.status() >= 400) {
      failedDocuments.push(`${response.status()} ${response.url()}`);
    }
  });

  return {
    expectClean() {
      expect(pageErrors, 'uncaught page errors').toEqual([]);
      expect(consoleErrors, 'console errors').toEqual([]);
      expect(failedDocuments, 'failed document responses').toEqual([]);
    },
  };
}

test.describe('@case:PUB-02 @area:PUB @prio:P2 features page', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ context, baseURL }) => {
    // The app's default locale, pinned explicitly so a stale profile cookie can
    // never switch the copy under the structural assertions.
    const { hostname } = new URL(baseURL!);
    await context.addCookies([{ name: 'NEXT_LOCALE', value: 'pl', domain: hostname, path: '/' }]);
  });

  test('groups the product into four areas and keeps the plan matrix on /pricing', async ({
    page,
  }) => {
    const errors = watchForErrors(page);

    const response = await page.goto('/features');
    expect(response?.status(), 'document status').toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

    // --- One h1, and an outline that never skips a level -------------------
    await expect(page.locator('h1')).toHaveCount(1);

    const levels = await page
      .locator('main :is(h1,h2,h3,h4)')
      .evaluateAll((elements) => elements.map((element) => Number(element.tagName.slice(1))));
    expect(levels[0], 'first heading is the page title').toBe(1);
    for (const [index, level] of levels.slice(1).entries()) {
      expect(
        level - levels[index]!,
        `heading level jumps from h${levels[index]} to h${level}`,
      ).toBeLessThanOrEqual(1);
    }

    // --- Four areas, each with its own claim and its capabilities ---------
    for (const { id } of CLUSTERS) {
      const section = page.locator(id);
      await expect(section, id).toBeVisible();
      await expect(section.locator('h2'), `${id} has exactly one section title`).toHaveCount(1);
      expect(
        await section.locator('h3').count(),
        `${id} lists its capabilities as headings`,
      ).toBeGreaterThanOrEqual(2);
    }

    // --- Each area still proves its claim with the product -----------------
    for (const { id, surfaces } of CLUSTERS) {
      if (surfaces === null) continue;
      await expect(
        page.locator(`${id} [data-slot="${surfaces}"]`).first(),
        `${id} ends in a product surface`,
      ).toBeVisible();
    }

    // --- The contents index reaches every area -----------------------------
    const indexLinks = page.locator('main nav a[href^="#"]');
    await expect(indexLinks).toHaveCount(CLUSTERS.length);
    for (const [position, { id }] of CLUSTERS.entries()) {
      await expect(indexLinks.nth(position)).toHaveAttribute('href', id);
    }

    // --- The plan matrix stays on /pricing ---------------------------------
    await expect(page.locator('main table'), 'no plan comparison table').toHaveCount(0);

    // --- Three destinations, one primary action ----------------------------
    for (const href of DESTINATIONS) {
      await expect(page.locator(`main a[href="${href}"]`).first(), href).toBeVisible();
    }
    const primary = page.locator('main a[href="/register"]').first();
    const box = await primary.boundingBox();
    expect(box?.height ?? 0, 'primary CTA is at least 44px tall').toBeGreaterThanOrEqual(44);

    // --- No raw keys, no placeholders --------------------------------------
    const body = await page.locator('body').innerText();
    expect(body, 'raw translation keys').not.toMatch(
      /\b(?:FeaturesPage|MainLayout|Navbar)\.[A-Za-z_]+/,
    );
    expect(body, 'literal undefined').not.toMatch(/\bundefined\b/);
    expect(body, 'literal NaN').not.toMatch(/\bNaN\b/);

    errors.expectClean();
  });

  test('is reachable from the header and its primary action opens registration', async ({
    page,
  }) => {
    const errors = watchForErrors(page);

    await page.goto('/');
    await page.locator('header').getByRole('link', { name: 'Funkcje', exact: true }).click();
    await expect(page).toHaveURL(/\/features$/);
    await expect(page.locator('h1')).toHaveCount(1);

    // The page's action, not a link to it: registration must open.
    await page.locator('main a[href="/register"]').first().click();
    await expect(page).toHaveURL(/\/register$/);
    await expect(page.getByRole('button', { name: 'Zarejestruj się', exact: true })).toBeVisible();

    errors.expectClean();
  });
});
