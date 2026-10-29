import { expect, test, type Page } from '@playwright/test';

/**
 * PUB-03 — Strona „Cennik” (/pricing) – kafelki typów kont.
 *
 * Prerequisite is "Brak sesji": the picker is a public route, so the spec runs in
 * an empty storage state and never signs in. PUB-03's isolated tenant
 * (`qa/cases/PUB-03.md::PUB-03::qa-shared`, seeded with
 * `bun scripts/qa-tenant.ts PUB-03`) exists per case but is deliberately not used
 * for a session — the acceptance criteria belong to the anonymous visitor.
 *
 * The plan catalogue is global product config. The spec only reads it through the
 * public `GET /api/v1/subscription-plans?for=<type>` endpoint and compares the
 * rendered cards with it; no plan, setting or other singleton row is written.
 */

const PICKER_TITLE = 'Wybierz Swój Plan';
const PICKER_SUBTITLE = 'Zacznij za darmo, ulepsz gdy potrzebujesz więcej';

const TILES = [
  {
    label: 'Student',
    href: '/pricing/student',
    plansFor: 'student',
    planKeys: ['base', 'spark', 'ace', 'pro'],
    planNames: ['Base', 'Spark', 'Ace', 'Pro'],
  },
  {
    label: 'Edukator',
    href: '/pricing/edu',
    plansFor: 'educator',
    planKeys: ['lite', 'guide', 'creator', 'master'],
    planNames: ['Lite', 'Guide', 'Creator', 'Master'],
  },
  {
    label: 'Organizacja',
    href: '/pricing/org',
    plansFor: 'manager',
    planKeys: ['launch', 'team', 'hub', 'campus'],
    planNames: ['Launch', 'Team', 'Hub', 'Campus'],
  },
] as const;

interface PlanSummary {
  key: string;
  name: string;
}

/** Collect browser-side failures so "no errors" is asserted, not assumed. */
function watchForErrors(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedResponses: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
  });

  return {
    expectClean() {
      expect(pageErrors, 'uncaught page errors').toEqual([]);
      expect(consoleErrors, 'console errors').toEqual([]);
      expect(failedResponses, 'HTTP responses >= 400').toEqual([]);
    },
  };
}

/** The tile's overlay link, addressed by the account-type label it carries. */
function tileLink(page: Page, label: string) {
  return page.getByRole('link', { name: label, exact: true });
}

async function expectPicker(page: Page) {
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(
    page.getByRole('heading', { level: 1, name: PICKER_TITLE, exact: true }),
  ).toBeVisible();
  await expect(page.getByText(PICKER_SUBTITLE, { exact: true })).toBeVisible();

  // Exactly the three account types, one card each.
  await expect(page.locator('main [data-slot="card"]')).toHaveCount(TILES.length);

  for (const tile of TILES) {
    const link = tileLink(page, tile.label);
    await expect(link).toHaveAttribute('href', tile.href);

    const card = link.locator('..');
    await expect(card).toHaveAttribute('data-slot', 'card');

    // Icon + name + description.
    await expect(card.locator('svg').first()).toBeVisible();
    await expect(card.getByText(tile.label, { exact: true })).toBeVisible();
    const description = card.locator('p');
    await expect(description).toHaveCount(1);
    await expect(description).toBeVisible();
    expect((await description.innerText()).trim().length).toBeGreaterThan(10);

    // The whole tile is the link: no separate CTA, no plan counter in the tile.
    await expect(card.getByRole('link')).toHaveCount(1);
    await expect(card.getByRole('button')).toHaveCount(0);
    const tileText = (await card.innerText()).replace(/\s+/g, ' ').trim();
    expect(tileText, `${tile.label} tile plan counter`).not.toMatch(/\d/);
    expect(tileText, `${tile.label} tile "Zobacz N planów" CTA`).not.toMatch(/zobacz/i);

    // The overlay link spans the card itself (border-box vs padding-box: 1px border).
    const linkBox = await link.boundingBox();
    const cardBox = await card.boundingBox();
    expect(linkBox, `${tile.label} overlay box`).not.toBeNull();
    expect(cardBox, `${tile.label} card box`).not.toBeNull();
    for (const edge of ['x', 'y', 'width', 'height'] as const) {
      expect(
        Math.abs(linkBox![edge] - cardBox![edge]),
        `${tile.label} overlay ${edge} matches the card`,
      ).toBeLessThanOrEqual(2);
    }
  }

  // No separate "Zobacz N planów" affordance anywhere on the picker.
  await expect(page.locator('main').getByText(/zobacz/i)).toHaveCount(0);
}

async function expectPlanPage(page: Page, tile: (typeof TILES)[number]) {
  await expect(page).toHaveURL(new RegExp(`${tile.href}$`));

  // The plan page has no "Powrót do planów" link; the header "Cennik" link is
  // the documented way back.
  await expect(page.getByRole('link', { name: /powrót/i })).toHaveCount(0);
  await expect(
    page.locator('header').getByRole('link', { name: 'Cennik', exact: true }),
  ).toBeVisible();

  // The catalogue is read-only input: the page offers exactly the four plans for
  // this account type, in catalogue order, under the catalogue names.
  const response = await page.request.get(`/api/v1/subscription-plans?for=${tile.plansFor}`);
  expect(response.status(), `${tile.plansFor} plan catalogue`).toBe(200);
  const { data } = (await response.json()) as { data: PlanSummary[] };
  expect(data.map((plan) => plan.key)).toEqual([...tile.planKeys]);
  for (const name of tile.planNames) {
    expect(data.map((plan) => plan.name)).toContain(`StudiQ ${name}`);
  }

  await expect(page.locator('main [data-slot="card"]')).toHaveCount(tile.planKeys.length);
  const titles = (await page.locator('main [data-slot="card-title"]').allTextContents()).map(
    (title) => title.trim(),
  );
  expect(titles).toEqual(data.map((plan) => plan.name));
}

test.describe('@case:PUB-03 @area:PUB @prio:P1 pricing tiles', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ context, baseURL }) => {
    // A returning Polish visitor: the app's default locale, pinned explicitly so
    // a stale profile cookie can never switch the copy under the assertions.
    const { hostname } = new URL(baseURL!);
    await context.addCookies([{ name: 'NEXT_LOCALE', value: 'pl', domain: hostname, path: '/' }]);
  });

  test('three account tiles open the matching plan pages with four plans each', async ({
    page,
  }) => {
    const errors = watchForErrors(page);

    const response = await page.goto('/pricing');
    expect(response?.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

    // Prerequisite "Brak sesji": the visitor is not authenticated.
    const me = await page.request.get('/api/v1/auth/me');
    expect(me.status()).toBe(200);
    const meBody = (await me.json()) as { data?: { user?: unknown } };
    expect(meBody.data?.user ?? null).toBeNull();

    await expectPicker(page);

    for (const tile of TILES) {
      // Click the card body, not the anchor text: the whole tile is the link.
      const card = tileLink(page, tile.label).locator('..');
      const box = await card.boundingBox();
      expect(box, `${tile.label} card box`).not.toBeNull();
      await card.click({ position: { x: 10, y: box!.height / 2 } });

      await expectPlanPage(page, tile);

      // Back to the picker through the header, never the browser history.
      await page.locator('header').getByRole('link', { name: 'Cennik', exact: true }).click();
      await expectPicker(page);
    }

    // Adjacent regression: every plan page is reachable by deep link, not only
    // by clicking through the picker.
    for (const tile of TILES) {
      await page.goto(tile.href);
      await expectPlanPage(page, tile);
    }

    errors.expectClean();
  });
});
