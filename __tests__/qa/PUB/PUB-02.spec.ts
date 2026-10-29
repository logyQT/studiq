import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * PUB-02 — Strona „Funkcje” (/features) dla gościa bez sesji.
 *
 * Prerequisite is "Brak sesji": the page is a public route, so the spec signs
 * nobody in and sends no storage state. PUB-02's isolated tenant
 * (`tenantKey("qa/cases/PUB-02.md", "PUB-02", "qa-shared")` →
 * `PUB-02.md::PUB-02::qa-shared`, seeded with `bun scripts/qa-tenant.ts PUB-02`)
 * is bookkeeping only — the page reads no tenant, plan, feature-flag or singleton
 * row, so the spec consumes no user, org or content id.
 *
 * Product decision on the comparison table (case says values "Tak / Nie /
 * Indywidualny"): every one of the eleven rows is binary, so the table only ever
 * carries Tak / Nie and `FeaturesPage.comparison_custom` stays unused — see
 * #291 / PR #639 ("the table has no row whose value is custom"). The spec asserts
 * that binary matrix as the intended behaviour.
 *
 * The value cells are icons: a `lucide-check` for "Tak", an em dash for "Nie"
 * (both decorative; since #639 a screen-reader label accompanies them). The spec
 * reads the visible marker, so it holds both before and after that a11y fix.
 */

const TITLE = 'Wszystko Czego Potrzebujesz, Aby Odnieść Sukces';
const SUBTITLE = 'Od podstawowych fiszek po egzaminy oparte na AI';
const COMPARISON_TITLE = 'Porównanie Planów';
const CTA = 'Zacznij Za Darmo';

type Plan = 'Darmowy' | 'Premium' | 'Uniwersytecki';

const FEATURES: readonly { title: string; plan: Plan }[] = [
  { title: 'Ręczne Tworzenie Pytań', plan: 'Darmowy' },
  { title: 'Ćwiczenie z Fiszkami', plan: 'Darmowy' },
  { title: 'Rozwiązywanie Testów', plan: 'Darmowy' },
  { title: 'Podstawowe Statystyki', plan: 'Darmowy' },
  { title: 'Generowanie Pytań przez AI', plan: 'Premium' },
  { title: 'Generowanie Fiszek przez AI', plan: 'Premium' },
  { title: 'Symulacja Egzaminu AI', plan: 'Premium' },
  { title: 'Zaawansowana Analityka', plan: 'Premium' },
  { title: 'Zarządzanie Organizacją', plan: 'Uniwersytecki' },
  { title: 'Masowe Zaproszenia', plan: 'Uniwersytecki' },
  { title: 'Analityka Uczelni', plan: 'Uniwersytecki' },
] as const;

const PLAN_TOTALS: Record<Plan, number> = {
  Darmowy: 4,
  Premium: 4,
  Uniwersytecki: 3,
};

const COLUMNS = ['Funkcja', 'Darmowy', 'Premium', 'Uniwersytecki'] as const;

type Included = true | false;

const PLAN_RANK: Record<Plan, number> = { Darmowy: 0, Premium: 1, Uniwersytecki: 2 };

/** A plan column includes a feature when it is at least the feature's own plan. */
function includes(column: Plan, feature: Plan): Included {
  return PLAN_RANK[column] >= PLAN_RANK[feature];
}

/**
 * The table's plan matrix: the four base features are in every plan, the four AI
 * features are Premium and up, the three organisation features are University only.
 */
const COMPARISON: readonly {
  feature: string;
  free: Included;
  premium: Included;
  university: Included;
}[] = FEATURES.map(({ title, plan }) => ({
  feature: title,
  free: includes('Darmowy', plan),
  premium: includes('Premium', plan),
  university: includes('Uniwersytecki', plan),
}));

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

/** The `<section>` that owns a given heading — the page has no test ids. */
function sectionWithHeading(page: Page, name: string) {
  return page
    .locator('main section')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });
}

/**
 * One comparison cell carries exactly one visible value: a check icon ("Tak")
 * or an em dash ("Nie"). Anything else — no marker, both markers — is a failure,
 * because the cell would then say nothing to a sighted visitor.
 */
async function expectCellValue(cell: Locator, included: Included, where: string): Promise<void> {
  const check = cell.locator('svg.lucide-check');
  const dash = cell.getByText('—', { exact: true });

  if (included) {
    await expect(check, `${where} is included`).toHaveCount(1);
    await expect(dash, `${where} is not "Nie"`).toHaveCount(0);
  } else {
    await expect(dash, `${where} is not included`).toHaveCount(1);
    await expect(check, `${where} is not "Tak"`).toHaveCount(0);
  }
}

async function expectFeaturesPage(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/features$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
  await expect(page).toHaveTitle(/^Funkcje/);

  // --- Title / hero -------------------------------------------------------
  await expect(page.getByRole('heading', { level: 1, name: TITLE, exact: true })).toBeVisible();
  await expect(page.getByText(SUBTITLE, { exact: true })).toBeVisible();

  // --- Feature cards with a plan badge ------------------------------------
  const cards = page.locator('main [data-slot="card"]');
  await expect(cards).toHaveCount(FEATURES.length);

  const badges = page.locator('main [data-slot="badge"]');
  await expect(badges).toHaveCount(FEATURES.length);
  for (const [plan, total] of Object.entries(PLAN_TOTALS) as [Plan, number][]) {
    await expect(badges.filter({ hasText: plan }), `${plan} badges`).toHaveCount(total);
  }

  for (const [index, feature] of FEATURES.entries()) {
    const card = cards.nth(index);
    const where = `card ${index + 1} (${feature.title})`;

    // Icon + one plan badge carrying exactly this feature's plan.
    await expect(card.locator('svg').first(), `${where} icon`).toBeVisible();
    const badge = card.locator('[data-slot="badge"]');
    await expect(badge, `${where} plan badge`).toHaveCount(1);
    await expect(badge).toHaveText(feature.plan);

    await expect(card.locator('[data-slot="card-title"]'), `${where} title`).toHaveText(
      feature.title,
    );

    // The card is readable, not an empty shell.
    const description = card.locator('[data-slot="card-content"] p');
    await expect(description, `${where} description`).toHaveCount(1);
    expect(
      (await description.innerText()).trim().length,
      `${where} description copy`,
    ).toBeGreaterThan(30);
  }

  // --- Plan comparison table ----------------------------------------------
  const comparison = sectionWithHeading(page, COMPARISON_TITLE);
  await expect(
    comparison.getByRole('heading', { level: 2, name: COMPARISON_TITLE, exact: true }),
  ).toBeVisible();

  const table = comparison.locator('table');
  await expect(table).toHaveCount(1);

  await expect(table.locator('thead th')).toHaveText([...COLUMNS]);

  const rows = table.locator('tbody tr');
  await expect(rows).toHaveCount(COMPARISON.length);

  for (const [index, row] of COMPARISON.entries()) {
    const cells = rows.nth(index).locator('td, th');
    await expect(cells).toHaveCount(COLUMNS.length);
    await expect(cells.first(), `row ${index + 1} feature name`).toHaveText(row.feature);

    await expectCellValue(cells.nth(1), row.free, `${row.feature} / Darmowy`);
    await expectCellValue(cells.nth(2), row.premium, `${row.feature} / Premium`);
    await expectCellValue(cells.nth(3), row.university, `${row.feature} / Uniwersytecki`);
  }

  // --- No raw translation keys, no "undefined"/"NaN" placeholders ----------
  const body = await page.locator('body').innerText();
  expect(body, 'raw translation keys').not.toMatch(
    /\b(?:FeaturesPage|MainLayout|Navbar)\.[A-Za-z_]+/,
  );
  expect(body, 'literal undefined').not.toMatch(/\bundefined\b/);
  expect(body, 'literal NaN').not.toMatch(/\bNaN\b/);
}

test.describe('@case:PUB-02 @area:PUB @prio:P2 features page', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ context, baseURL }) => {
    // A returning Polish visitor: the app's default locale, pinned explicitly so
    // a stale profile cookie can never switch the copy under the assertions.
    const { hostname } = new URL(baseURL!);
    await context.addCookies([{ name: 'NEXT_LOCALE', value: 'pl', domain: hostname, path: '/' }]);
  });

  test('lists every feature with its plan and the full plan comparison table', async ({ page }) => {
    const errors = watchForErrors(page);

    const response = await page.goto('/features');
    expect(response?.status(), 'document status').toBe(200);

    // Prerequisite "Brak sesji": the visitor is not authenticated.
    const me = await page.request.get('/api/v1/auth/me');
    expect(me.status()).toBe(200);
    const meBody = (await me.json()) as { data?: { user?: unknown } };
    expect(meBody.data?.user ?? null).toBeNull();

    await expectFeaturesPage(page);

    // The CTA is the last section's call to action and points at registration.
    const cta = sectionWithHeading(page, 'Gotowy, Aby Zacząć Naukę?').getByRole('link', {
      name: CTA,
      exact: true,
    });
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute('href', '/register');

    errors.expectClean();
  });

  test('is reachable from the header and its CTA opens the registration form', async ({ page }) => {
    const errors = watchForErrors(page);

    await page.goto('/');
    await page.locator('header').getByRole('link', { name: 'Funkcje', exact: true }).click();
    await expectFeaturesPage(page);

    // Case step: "Przycisk «Zacznij Za Darmo» prowadzi do rejestracji".
    await page.getByRole('link', { name: CTA, exact: true }).click();
    await expect(page).toHaveURL(/\/register$/);
    await expect(page.getByText('Utwórz konto', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zarejestruj się', exact: true })).toBeVisible();

    errors.expectClean();
  });
});
