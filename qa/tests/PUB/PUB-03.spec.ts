import { expect, test, type Page } from '@playwright/test';

/**
 * PUB-03 — Strona „Cennik” (/pricing) – kafelki typów kont.
 *
 * Prerequisite: no session. The picker is a public route, so the spec runs with
 * an empty storage state and never uses the legacy manual accounts. The case's
 * isolated tenant (`qa/cases/PUB-03.md::PUB-03::qa-shared`, seeded with
 * `bun scripts/qa-tenant.ts PUB-03`) exists per case but is deliberately not
 * signed in — the acceptance criteria are the anonymous visitor's.
 *
 * The plan catalogue is global product config. The spec only reads it through
 * the public API and asserts that the page renders exactly those plans; it never
 * mutates plans, settings or any other singleton row.
 */

const PICKER_TITLE = 'Wybierz Swój Plan';
const PICKER_SUBTITLE = 'Zacznij za darmo, ulepsz gdy potrzebujesz więcej';

const TILES = [
  {
    label: 'Student',
    href: '/pricing/student',
    description:
      'Narzędzia edukacyjne oparte na AI zaprojektowane dla studentów, aby uczyć się mądrzej i zdawać egzaminy.',
    plansFor: 'student',
    planKeys: ['base', 'spark', 'ace', 'pro'],
  },
  {
    label: 'Edukator',
    href: '/pricing/edu',
    description:
      'Twórz angażujące materiały dydaktyczne i śledź postępy uczniów dzięki zaawansowanej analityce.',
    plansFor: 'educator',
    planKeys: ['lite', 'guide', 'creator', 'master'],
  },
  {
    label: 'Organizacja',
    href: '/pricing/org',
    description:
      'Platforma edukacyjna klasy enterprise z zarządzaniem zespołem i niestandardowym brandowaniem.',
    plansFor: 'manager',
    planKeys: ['launch', 'team', 'hub', 'campus'],
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

/** One picker tile: the card whose overlay link carries the account-type label. */
function tileLink(page: Page, label: string) {
  return page.getByRole('link', { name: label, exact: true });
}

function tileCard(page: Page, label: string) {
  return tileLink(page, label).locator('..');
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

    const card = tileCard(page, tile.label);
    await expect(card).toHaveAttribute('data-slot', 'card');
    // Icon + name + description.
    await expect(card.locator('svg').first()).toBeVisible();
    await expect(card.getByText(tile.label, { exact: true })).toBeVisible();
    await expect(card.getByText(tile.description, { exact: true })).toBeVisible();

    // The whole tile is the link: no separate CTA, no plan counter in the tile.
    await expect(card.getByRole('link')).toHaveCount(1);
    await expect(card.getByRole('button')).toHaveCount(0);
    const tileText = (await card.innerText()).replace(/\s+/g, ' ').trim();
    expect(tileText, `${tile.label} tile plan counter`).not.toMatch(/\d/);

    // The overlay link covers the card, not just its text. `inset-0` spans the
    // padding box, so the card's 1px border can differ on each side.
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

  // No separate "Zobacz N planów" affordance on the picker.
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

  // The catalogue is read-only input: assert the four plans this account type
  // is offered and that the page renders exactly them, in catalogue order.
  const response = await page.request.get(`/api/v1/subscription-plans?for=${tile.plansFor}`);
  expect(response.status(), `${tile.plansFor} plan catalogue`).toBe(200);
  const { data } = (await response.json()) as { data: PlanSummary[] };
  expect(data.map((plan) => plan.key)).toEqual([...tile.planKeys]);

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
      await tileLink(page, tile.label).click();
      await expectPlanPage(page, tile);

      // Back to the picker through the header, never the browser history.
      await page.locator('header').getByRole('link', { name: 'Cennik', exact: true }).click();
      await expectPicker(page);
    }

    // Adjacent regression: a plan page is reachable by deep link, not only by
    // clicking through the picker.
    await page.goto(TILES[1].href);
    await expectPlanPage(page, TILES[1]);

    errors.expectClean();
  });
});
