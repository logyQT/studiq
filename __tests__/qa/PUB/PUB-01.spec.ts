import { expect, test, type Page } from '@playwright/test';

/**
 * PUB-01 — Strona główna (/): dla gościa bez sesji.
 *
 * Prerequisite: no session, Polish locale. The landing page is public and its
 * acceptance criteria are the anonymous visitor's, so the case's isolated tenant
 * (`qa/cases/PUB-01.md::PUB-01::qa-shared`, seeded with
 * `bun scripts/qa-tenant.ts PUB-01`) is never signed in: no storage state, no
 * cookie, no fixture user. The spec therefore touches no tenant, plan or
 * singleton row. The pricing teaser is DB-driven global product config, so it is
 * asserted by section and link only — never by plan names or prices.
 *
 * Copy is deliberately not asserted. A Polish sentence lives in
 * `apps/web/src/i18n/messages/pl.json`; repeating it here would pin the string
 * rather than the page, and would go red the moment someone edits the wording
 * while every visitor-visible behaviour still works. What is pinned instead is
 * the contract a marketing page can actually break: section identity, the
 * heading outline, link targets, the locale, and a clean console.
 */

const SECTIONS = ['#hero', '#features', '#how-it-works', '#pricing', '#get-started'] as const;

/** Public destinations the visitor must be able to reach from the landing page. */
const HEADER_TARGETS = ['/features', '/pricing', '/login', '/register'] as const;
const FOOTER_TARGETS = ['/features', '/pricing', '/contact', '/privacy', '/terms'] as const;

/**
 * Collect browser-side failures so "the page loads without errors" is asserted,
 * not assumed. Only document responses are checked: the shared app is a dev
 * server, and asset/HMR noise is not part of this case.
 */
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

test.describe('PUB-01 — landing page for an anonymous visitor', () => {
  test('renders every section in Polish without browser errors', async ({ page }) => {
    const errors = watchForErrors(page);

    const response = await page.goto('/');
    expect(response?.status(), 'document status').toBe(200);

    // No session, default locale: the page must be Polish.
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

    // Section identity — each marketing block is present and deep-linkable.
    for (const selector of SECTIONS) {
      await expect(page.locator(selector), selector).toBeVisible();
    }

    // One h1, owned by the hero. A second top-level heading flattens the outline
    // for screen readers and for search engines.
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('#hero h1')).toBeVisible();

    // Every section carries a heading, so the page has a navigable outline.
    for (const selector of SECTIONS) {
      await expect(page.locator(`${selector} :is(h1,h2,h3)`).first(), selector).toBeVisible();
    }

    // No section renders blank. That is what a key that fails to resolve looks
    // like on screen, and no heading assertion catches it.
    const rendered = await page.locator('main section').allInnerTexts();
    for (const [index, text] of rendered.entries()) {
      expect(text.trim(), `section ${index} renders text`).not.toBe('');
    }

    // --- No raw translation keys, no "undefined"/"NaN" placeholders -------
    const body = await page.locator('body').innerText();
    expect(body, 'raw translation keys').not.toMatch(/\b(?:LandingPage|Navbar|Footer)\.[A-Za-z_]+/);
    expect(body, 'literal undefined').not.toMatch(/\bundefined\b/);
    expect(body, 'literal NaN').not.toMatch(/\bNaN\b/);

    errors.expectClean();
  });

  test('every CTA and navigation link reaches its public destination', async ({ page }) => {
    const errors = watchForErrors(page);
    await page.goto('/');

    // The two sales CTAs must carry an accessible name: an unlabeled call to
    // action is unusable with a screen reader, and it is the one link a visitor
    // is meant to find.
    for (const selector of ['#hero a', '#get-started a']) {
      for (const link of await page.locator(selector).all()) {
        expect((await link.innerText()).trim(), `${selector} link name`).not.toBe('');
      }
    }

    const header = page.locator('header');
    for (const href of HEADER_TARGETS) {
      await expect(header.locator(`a[href="${href}"]`).first(), href).toBeVisible();
    }

    // Hero: sign up first, feature tour second.
    const heroLinks = page.locator('#hero a');
    await expect(heroLinks).toHaveCount(2);
    await expect(heroLinks.nth(0)).toHaveAttribute('href', '/register');
    await expect(heroLinks.nth(1)).toHaveAttribute('href', '/features');

    await expect(page.locator('#get-started a').first()).toHaveAttribute('href', '/register');
    await expect(page.locator('#pricing a[href="/pricing"]').first()).toBeVisible();

    const footer = page.locator('footer');
    for (const href of FOOTER_TARGETS) {
      await expect(footer.locator(`a[href="${href}"]`).first(), href).toBeVisible();
    }

    errors.expectClean();
  });
});
