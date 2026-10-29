import { expect, test, type Page } from '@playwright/test';

/**
 * PUB-04 — Podstrona planów (/pricing/student) – karty planów.
 *
 * Prerequisite "Brak sesji": the plan page is public, so the spec runs with an
 * empty storage state and never signs in. PUB-04's isolated tenant
 * (`qa/cases/PUB-04.md::PUB-04::qa-shared`, seeded with
 * `bun scripts/qa-tenant.ts PUB-04`) exists per case but is deliberately not
 * used for a session — the acceptance criteria belong to the anonymous visitor.
 *
 * The plan catalogue is shared, mutable product config (QA-SUITE-APPROACH hard
 * limits), so the spec reads it through the public
 * `GET /api/v1/subscription-plans?for=student` endpoint and asserts that the
 * page renders *that* configuration: plan names and order, grosze → PLN price
 * formatting, the configured feature lists, and the `-1` → "Bez ograniczeń"
 * limit formatting. Only code-owned copy is pinned: the plan ladder, the CTA
 * labels, and the "Najpopularniejszy" badge.
 */

interface PlanInfo {
  key: string;
  name: string;
  priceMonthly: number;
  currency: string;
  features: string[];
  limits: Record<string, number>;
}

/** The student ladder the public pricing page documents (`base` … `pro`). */
const STUDENT_PLAN_KEYS = ['base', 'spark', 'ace', 'pro'] as const;

/** CTA copy per plan key — product copy from the Polish messages, not DB config. */
const PLAN_CTA: Record<string, string> = {
  base: 'Zacznij za Darmo',
  spark: 'Przejdź na Spark',
  ace: 'Wybierz Ace',
  pro: 'Wybierz Pro',
};

/** The student plan highlighted as the popular one. */
const POPULAR_PLAN = 'ace';

const PAGE_TITLE = 'Wybierz Swój Plan';
const PAGE_SUBTITLE = 'Zacznij za darmo, ulepsz gdy potrzebujesz więcej';
const COMPARISON_TITLE = 'Porównaj Plany';
const UNLIMITED = 'Bez ograniczeń';
const NO_VALUE = '—';

/** Polish labels for plan feature keys (mirrors the `PricingPage` messages). */
const FEATURE_LABELS: Record<string, string> = {
  flashcards: 'Fiszki',
  quiz: 'Testy',
  ai: 'Asystent AI',
  'ai.chat': 'Asystent AI',
  'advanced.stats': 'Zaawansowane Statystyki',
  documents: 'Obsługa Dokumentów',
  quiz_builder: 'Kreator Testów',
  org_manage: 'Zarządzanie Organizacją',
  group_manage: 'Zarządzanie Grupami',
  member_manage: 'Zarządzanie Członkami',
  role_builder: 'Kreator Ról',
  branding: 'Własny branding',
};

/** Unknown keys fall back to the humanized form the page itself renders. */
function featureLabel(key: string): string {
  const label = FEATURE_LABELS[key];
  if (label) return label;
  const humanized = key.replace(/[.\s-]+/g, ' ').trim();
  return humanized.charAt(0).toUpperCase() + humanized.slice(1);
}

/** Comparison-table order and labels (`apps/web/src/lib/pricing-limits.ts`). */
const SORTED_LIMIT_KEYS = [
  'max_flashcards',
  'max_decks',
  'max_questions',
  'max_question_banks',
  'max_quiz_attempts_per_day',
  'max_ai_tokens_per_day',
  'max_students',
  'max_groups',
] as const;

/** Seat/group limits never apply to a student's personal plan. */
const ORG_ONLY_LIMIT_KEYS: readonly string[] = ['max_students', 'max_groups'];

const LIMIT_LABELS: Record<string, string> = {
  max_flashcards: 'Maks. fiszki',
  max_decks: 'Maks. talie',
  max_questions: 'Maks. pytania',
  max_question_banks: 'Maks. banki pytań',
  max_quiz_attempts_per_day: 'Próby dziennie',
  max_ai_tokens_per_day: 'Tokeny AI / dzień',
  max_students: 'Maks. studentów',
  max_groups: 'Maks. grup',
};

/** Limit keys the student comparison must render, in order. */
function visibleLimitKeys(plans: PlanInfo[]): string[] {
  return SORTED_LIMIT_KEYS.filter(
    (key) => !ORG_ONLY_LIMIT_KEYS.includes(key) && plans.some((plan) => key in plan.limits),
  );
}

/** "9,99 zł" → 9.99 (the price is stored in grosze and must be divided by 100). */
function moneyValue(amount: string): number {
  return Number(amount.replace(/zł/gi, '').replace(/\s/g, '').replace(',', '.'));
}

/**
 * A comparison-table limit cell: a number (k = thousands), "Bez ograniczeń" for
 * `-1`, or "—" when the plan does not carry the limit at all. Number grouping is
 * accepted in either locale form; the numeric value must match the configuration.
 */
function readLimitCell(raw: string, key: string): number | typeof UNLIMITED | typeof NO_VALUE {
  const text = raw
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text === UNLIMITED) return UNLIMITED;
  if (text === NO_VALUE) return NO_VALUE;

  let body = text;
  if (key === 'max_ai_tokens_per_day') {
    expect(text, `${key} cell "${raw}" carries the per-day suffix`).toMatch(/\/ dzień$/);
    body = text.replace(/\s*\/\s*dzień$/, '');
  }

  expect(body, `${key} cell "${raw}" is a number`).toMatch(/^\d[\d.,\s]*k?$/);
  const compact = body.replace(/\s/g, '');
  const thousands = compact.endsWith('k');
  const value = Number(compact.replace(/[.,]/g, '').replace(/k$/i, ''));
  return thousands ? value * 1000 : value;
}

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

async function fetchStudentPlans(page: Page): Promise<PlanInfo[]> {
  const response = await page.request.get('/api/v1/subscription-plans?for=student');
  expect(response.status(), 'student plan catalogue').toBe(200);
  const { data } = (await response.json()) as { data: PlanInfo[] };
  return data;
}

test.describe('@case:PUB-04 @area:PUB @prio:P2 student plan cards', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ context, baseURL }) => {
    // A returning Polish visitor: the suite asserts Polish copy, so pin the locale
    // so a stale profile cookie can never switch it under the assertions.
    const { hostname } = new URL(baseURL!);
    await context.addCookies([{ name: 'NEXT_LOCALE', value: 'pl', domain: hostname, path: '/' }]);
  });

  test('renders every student plan card and limit from the plan configuration', async ({
    page,
  }) => {
    const errors = watchForErrors(page);

    // Step 1 — open the page directly, as an anonymous visitor.
    const response = await page.goto('/pricing/student');
    expect(response?.status(), 'document status').toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
    await expect(page).toHaveTitle(/^Student \| StudiQ$/);

    // Prerequisite "Brak sesji": no user, so no "Obecny Plan" and no checkout CTA.
    const me = await page.request.get('/api/v1/auth/me');
    expect(me.status()).toBe(200);
    const meBody = (await me.json()) as { data?: { user?: unknown } };
    expect(meBody.data?.user ?? null).toBeNull();

    await expect(
      page.getByRole('heading', { level: 1, name: PAGE_TITLE, exact: true }),
    ).toBeVisible();
    await expect(page.getByText(PAGE_SUBTITLE, { exact: true })).toBeVisible();

    const plans = await fetchStudentPlans(page);
    expect(
      plans.map((plan) => plan.key),
      'the student ladder is Base, Spark, Ace and Pro',
    ).toEqual([...STUDENT_PLAN_KEYS]);

    // Step 2 — one card per configured plan, in catalogue order.
    const cards = page.locator('main [data-slot="card"]');
    await expect(cards).toHaveCount(plans.length);
    const titles = (await page.locator('main [data-slot="card-title"]').allTextContents()).map(
      (title) => title.trim(),
    );
    expect(titles).toEqual(plans.map((plan) => plan.name));

    for (const [index, plan] of plans.entries()) {
      const card = cards.nth(index);
      await expect(card.locator('[data-slot="card-title"]')).toHaveText(plan.name);

      // Name + a readable description ("—" is not a description).
      const description = card.locator('[data-slot="card-header"] p');
      await expect(description).toHaveCount(1);
      expect((await description.innerText()).trim().length).toBeGreaterThan(10);
      expect(await description.innerText(), `${plan.key} description is copy`).not.toMatch(
        /^plan_/,
      );

      // Price: the configured grosze value rendered as PLN, e.g. 999 → "9,99 zł".
      const priceBlock = card.locator('[data-slot="card-content"] > div').first();
      const priceLine = (await priceBlock.innerText())
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const priceMatch = /^(?<amount>[\d\s.,]+zł)(?<period>\/miesiąc)?$/.exec(priceLine);
      expect(priceMatch, `${plan.key} price line "${priceLine}"`).not.toBeNull();
      const amount = priceMatch!.groups!.amount;
      const period = priceMatch!.groups!.period;

      expect(moneyValue(amount), `${plan.key} price from grosze`).toBe(plan.priceMonthly / 100);
      if (plan.priceMonthly > 0) {
        // A paid plan is sold per month and keeps the grosze decimals.
        expect(period, `${plan.key} billing period`).toBe('/miesiąc');
        if (plan.priceMonthly % 100 !== 0) {
          expect(amount, `${plan.key} grosze are shown`).toMatch(/,\d{2}\s*zł$/);
        }
      } else {
        expect(period, `${plan.key} free plan has no billing period`).toBeUndefined();
        expect(amount, `${plan.key} free price`).toMatch(/^0\s*zł$/);
      }

      // Features: exactly the configured feature list, labelled in Polish.
      const features = (
        await card.locator('[data-slot="card-content"] ul li').allTextContents()
      ).map((feature) => feature.trim());
      const expectedFeatures = plan.features.map(featureLabel);
      expect(features.length, `${plan.key} feature count`).toBeGreaterThan(0);
      expect(features.length, `${plan.key} has no duplicate features`).toBe(new Set(features).size);
      expect([...features].sort(), `${plan.key} feature labels`).toEqual(
        [...expectedFeatures].sort(),
      );

      // CTA: one link per card, specific to the plan, pointing an anonymous
      // visitor at registration.
      const cta = card.locator('[data-slot="card-content"] a');
      await expect(cta, `${plan.key} CTA`).toHaveCount(1);
      await expect(cta).toHaveText(PLAN_CTA[plan.key]);
      await expect(cta).toHaveAttribute('href', '/register');
    }

    // CTA labels really differ per plan.
    expect(new Set(Object.values(PLAN_CTA)).size).toBe(plans.length);

    // "Najpopularniejszy" marks exactly the documented popular plan, once.
    const badges = page.locator('main [data-slot="badge"]');
    await expect(badges).toHaveCount(1);
    await expect(badges).toHaveText('Najpopularniejszy');
    const popularPlan = plans.find((plan) => plan.key === POPULAR_PLAN)!;
    await expect(badges.locator('..').locator('[data-slot="card-title"]')).toHaveText(
      popularPlan.name,
    );

    // Limits live in the comparison table; each cell must show the configured
    // value and read "Bez ograniczeń" where the catalogue stores -1.
    await expect(
      page.getByRole('heading', { level: 2, name: COMPARISON_TITLE, exact: true }),
    ).toBeVisible();
    const table = page.locator('main table');
    await expect(table).toBeVisible();

    const headers = (await table.locator('thead th').allTextContents()).map((header) =>
      header.trim(),
    );
    expect(headers[0].length, 'the first column is labelled').toBeGreaterThan(0);
    expect(headers.slice(1), 'comparison columns follow the card order').toEqual(
      plans.map((plan) => plan.name),
    );

    const limitKeys = visibleLimitKeys(plans);
    const featureKeys = [...new Set(plans.flatMap((plan) => plan.features))].sort();
    const rows = table.locator('tbody tr');
    await expect(rows).toHaveCount(featureKeys.length + limitKeys.length);

    const rowLabels = (await rows.locator('td:first-child').allTextContents()).map((label) =>
      label.trim(),
    );
    expect(rowLabels.slice(0, featureKeys.length), 'feature rows').toEqual(
      featureKeys.map(featureLabel),
    );
    expect(rowLabels.slice(featureKeys.length), 'limit rows').toEqual(
      limitKeys.map((key) => LIMIT_LABELS[key]),
    );

    for (const [rowIndex, feature] of featureKeys.entries()) {
      for (const [planIndex, plan] of plans.entries()) {
        const cell = rows
          .nth(rowIndex)
          .locator('td')
          .nth(planIndex + 1);
        const included = plan.features.includes(feature);
        await expect(
          cell.locator(included ? 'svg.lucide-check' : 'svg.lucide-minus'),
          `${plan.key} × ${feature}`,
        ).toHaveCount(1);
      }
    }

    for (const [offset, key] of limitKeys.entries()) {
      const row = rows.nth(featureKeys.length + offset);
      await expect(row.locator('td').first()).toHaveText(LIMIT_LABELS[key]);
      for (const [planIndex, plan] of plans.entries()) {
        const configured = plan.limits[key];
        const cellText = (
          await row
            .locator('td')
            .nth(planIndex + 1)
            .innerText()
        ).trim();
        const rendered = readLimitCell(cellText, key);
        if (configured === undefined) {
          expect(rendered, `${plan.key} ${key} (absent)`).toBe(NO_VALUE);
        } else if (configured === -1) {
          expect(rendered, `${plan.key} ${key} (-1)`).toBe(UNLIMITED);
        } else {
          expect(rendered, `${plan.key} ${key}`).toBe(configured);
        }
      }
    }

    // No raw translation keys or missing values on the page.
    const body = await page.locator('main').innerText();
    expect(body, 'raw translation keys').not.toMatch(/\b(?:PricingPage|Common)\.[A-Za-z_]+/);
    expect(body, 'literal undefined').not.toMatch(/\bundefined\b/);
    expect(body, 'literal NaN').not.toMatch(/\bNaN\b/);

    // Adjacent regression: the page is reachable by direct link and survives a
    // reload with the same catalogue (no client-side-only pricing state).
    await page.reload();
    await expect(cards).toHaveCount(plans.length);
    await expect(page.getByRole('heading', { level: 1, name: PAGE_TITLE })).toBeVisible();

    errors.expectClean();
  });
});
