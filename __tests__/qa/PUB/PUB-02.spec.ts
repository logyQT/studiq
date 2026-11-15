import { json } from '#test/helpers/json';
import pl from '@/i18n/messages/pl.json';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createTranslator } from 'next-intl';

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
 * Indywidualny"): every one of the ten rows is binary, so the table only ever
 * carries Tak / Nie and `FeaturesPage.comparison_custom` stays unused — see
 * #291 / PR #639 ("the table has no row whose value is custom"). The spec asserts
 * that binary matrix as the intended behaviour.
 *
 * The value cells are icons: a `lucide-check` for "Tak", an em dash for "Nie"
 * (both decorative; since #639 a screen-reader label accompanies them). The spec
 * reads the visible marker, so it holds both before and after that a11y fix.
 */

/**
 * The page's copy, read from the catalogue it renders from: the spec pins which
 * features, plans and labels the page shows, not the wording that spells them. A
 * copy edit moves the expectation with the page; the plan counts and the
 * inclusion matrix below stay literal because they are what the case asserts.
 */
const copy = createTranslator({ locale: 'pl', messages: pl, namespace: 'FeaturesPage' });
/** The shell the page is reached through, and the form its CTA opens. */
const navbarCopy = createTranslator({ locale: 'pl', messages: pl, namespace: 'Navbar' });
const registerCopy = createTranslator({ locale: 'pl', messages: pl, namespace: 'RegisterPage' });

const TITLE = copy('title');
/**
 * The hero's range claim, pinned because it enumerates what the product covers:
 * manual cards at one end, whole-institution analytics at the other. Copy that
 * promises a capability the app does not ship (an AI exam simulation) fails here
 * rather than on a visitor's first login. It is the one string on this page that
 * is a claim rather than a label, so it stays literal.
 */
const SUBTITLE = 'Od ręcznych fiszek po analitykę dla całej uczelni';
const COMPARISON_TITLE = copy('comparison_title');
const CTA = copy('cta_button');

type Plan = 'free' | 'premium' | 'university';

/** A plan's name as the comparison table spells it: the column header. */
const PLAN_LABEL: Record<Plan, string> = {
  free: copy('comparison_free'),
  premium: copy('comparison_premium'),
  university: copy('comparison_university'),
};

/**
 * The badge reuses one plan-name key per tier (`planBadge` in the page), so it is
 * read from that key rather than from the table's column label: the two are
 * separate messages and a copy edit to one must not fail the other.
 */
const PLAN_BADGE: Record<Plan, string> = {
  free: copy('manual_questions_plan'),
  premium: copy('ai_questions_plan'),
  university: copy('org_management_plan'),
};

const FEATURES: readonly { title: string; plan: Plan }[] = [
  { title: copy('manual_questions'), plan: 'free' },
  { title: copy('flashcard_practice'), plan: 'free' },
  { title: copy('quiz_taking'), plan: 'free' },
  { title: copy('basic_stats'), plan: 'free' },
  { title: copy('ai_questions'), plan: 'premium' },
  { title: copy('ai_flashcards'), plan: 'premium' },
  { title: copy('advanced_stats'), plan: 'premium' },
  { title: copy('org_management'), plan: 'university' },
  { title: copy('bulk_invites'), plan: 'university' },
  { title: copy('uni_analytics'), plan: 'university' },
] as const;

/** The three plans, in the ladder the page badges. */
const PLANS = ['free', 'premium', 'university'] as const satisfies readonly Plan[];

/** How many cards each plan badges — counted from the case, not from the page. */
const PLAN_TOTALS: Record<Plan, number> = {
  free: 4,
  premium: 3,
  university: 3,
};

/** The table header: the feature column, then one column per plan. */
const COLUMNS = [
  copy('comparison_feature'),
  PLAN_LABEL.free,
  PLAN_LABEL.premium,
  PLAN_LABEL.university,
] as const;

type Included = true | false;

const PLAN_RANK: Record<Plan, number> = { free: 0, premium: 1, university: 2 };

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
  free: includes('free', plan),
  premium: includes('premium', plan),
  university: includes('university', plan),
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
  // The root layout's `%s | StudiQ` template appends the site name.
  await expect(page).toHaveTitle(`${copy('meta_title')} | StudiQ`);

  // --- Title / hero -------------------------------------------------------
  await expect(page.getByRole('heading', { level: 1, name: TITLE, exact: true })).toBeVisible();
  await expect(page.getByText(SUBTITLE, { exact: true })).toBeVisible();

  // --- Feature cards with a plan badge ------------------------------------
  const cards = page.locator('main [data-slot="card"]');
  await expect(cards).toHaveCount(FEATURES.length);

  const badges = page.locator('main [data-slot="badge"]');
  await expect(badges).toHaveCount(FEATURES.length);
  for (const plan of PLANS) {
    await expect(badges.filter({ hasText: PLAN_BADGE[plan] }), `${plan} badges`).toHaveCount(
      PLAN_TOTALS[plan],
    );
  }

  for (const [index, feature] of FEATURES.entries()) {
    const card = cards.nth(index);
    const where = `card ${index + 1} (${feature.title})`;

    // Icon + one plan badge carrying exactly this feature's plan.
    await expect(card.locator('svg').first(), `${where} icon`).toBeVisible();
    const badge = card.locator('[data-slot="badge"]');
    await expect(badge, `${where} plan badge`).toHaveCount(1);
    await expect(badge).toHaveText(PLAN_BADGE[feature.plan]);

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

    await expectCellValue(cells.nth(1), row.free, `${row.feature} / ${PLAN_LABEL.free}`);
    await expectCellValue(cells.nth(2), row.premium, `${row.feature} / ${PLAN_LABEL.premium}`);
    await expectCellValue(
      cells.nth(3),
      row.university,
      `${row.feature} / ${PLAN_LABEL.university}`,
    );
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
    const meBody = await json<{ data?: { user?: unknown } }>(me);
    expect(meBody.data?.user ?? null).toBeNull();

    await expectFeaturesPage(page);

    // The CTA is the last section's call to action and points at registration.
    const cta = sectionWithHeading(page, copy('cta_title')).getByRole('link', {
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
    await page
      .locator('header')
      .getByRole('link', { name: navbarCopy('features'), exact: true })
      .click();
    await expectFeaturesPage(page);

    // Case step: "Przycisk «Zacznij Za Darmo» prowadzi do rejestracji".
    await page.getByRole('link', { name: CTA, exact: true }).click();
    await expect(page).toHaveURL(/\/register$/);
    await expect(page.getByText(registerCopy('header'), { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: registerCopy('register_button'), exact: true }),
    ).toBeVisible();

    errors.expectClean();
  });
});
