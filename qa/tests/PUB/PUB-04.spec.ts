import { expect, test, type Page } from '@playwright/test';
import pl from '@/i18n/messages/pl.json';
import { loadQaTenant, pinLocale, signInAs } from '#qa/fixtures/qa-tenant';

/**
 * PUB-04 — /pricing/student plan cards.
 *
 * The acceptance criteria are "the cards agree with the plan configuration", so the
 * spec reads the active student catalog once (`GET /api/v1/subscription-plans?for=student`)
 * and asserts the page against it. The catalog is a shared, read-only singleton: this
 * spec never mutates plans, flags or any other shared row.
 *
 * The seeded tenant (`tenantKey("qa/cases/PUB-04.md", "PUB-04", "qa-shared")`) is used
 * for the signed-in variant: the current-plan badge and the checkout CTA.
 */

const PRICING = pl.PricingPage as Record<string, string>;

// The comparison table groups numbers with the browser default locale
// (`Number#toLocaleString()` without an argument). Pin it so a runner whose
// Chromium is en-US cannot change the rendered limits.
test.use({ locale: 'pl-PL' });

/** Student plans in display (sort_order) order, per the product plan model. */
const STUDENT_PLAN_KEYS = ['base', 'spark', 'ace', 'pro'] as const;

/** The card CTA copy differs per plan (the free tier uses `cta_free`). */
const CTA_MESSAGE_KEY: Record<string, string> = {
  base: 'cta_free',
  spark: 'cta_spark',
  ace: 'cta_ace',
  pro: 'cta_pro',
};

/** Limit rows a student plan comparison must show. Seats/groups are org-only. */
const STUDENT_LIMIT_KEYS = [
  'max_flashcards',
  'max_decks',
  'max_questions',
  'max_question_banks',
  'max_quiz_attempts_per_day',
  'max_ai_tokens_per_day',
] as const;

const ORG_ONLY_LIMIT_KEYS = ['max_students', 'max_groups'] as const;

interface PlanInfo {
  key: string;
  name: string;
  priceMonthly: number;
  currency: string;
  features: string[];
  limits: Record<string, number>;
  sortOrder: number;
}

/** The page normalises non-breaking spaces to plain spaces; compare the same way. */
function normalize(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Mirrors the card's price formatter: grosze -> currency, no decimals when whole. */
function formatPrice(plan: PlanInfo): string {
  return new Intl.NumberFormat('pl', {
    style: 'currency',
    currency: plan.currency,
    minimumFractionDigits: 0,
  }).format(plan.priceMonthly / 100);
}

/** Mirrors `getFeatureLabel`: `ai.chat` -> `feature_ai_chat` -> "Asystent AI". */
function featureLabel(feature: string): string {
  const normalized = feature.replace(/[.\s-]+/g, '_');
  const message = PRICING[`feature_${normalized}`];
  if (message) return message;
  const words = normalized.replace(/_+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : feature;
}

/** Mirrors `formatLimitValue`: -1 is unlimited, AI tokens are shown in thousands. */
function formatLimit(key: string, value: number): string {
  if (value === -1) return PRICING.limit_unlimited;
  if (key === 'max_ai_tokens_per_day') {
    const tokens = value >= 1000 ? `${(value / 1000).toLocaleString('pl-PL')}k` : String(value);
    return PRICING.limit_per_day.replace('{value}', tokens);
  }
  return value.toLocaleString('pl-PL');
}

async function fetchStudentPlans(page: Page): Promise<PlanInfo[]> {
  const response = await page.request.get('/api/v1/subscription-plans?for=student');
  expect(response.status(), 'GET /api/v1/subscription-plans?for=student').toBe(200);

  const payload = (await response.json()) as { success: boolean; data: PlanInfo[] };
  expect(payload.success).toBe(true);

  const plans = payload.data;
  expect(plans.map((plan) => plan.key)).toEqual([...STUDENT_PLAN_KEYS]);
  for (const plan of plans) expect(plan.currency).toBe('PLN');
  return plans;
}

function planCards(page: Page) {
  return page.locator('main [data-slot="card"]');
}

test.describe('PUB-04 — /pricing/student plan cards', () => {
  test('renders every student plan with its configured price, features, CTA and the popular badge', async ({
    page,
  }) => {
    await pinLocale(page);
    const plans = await fetchStudentPlans(page);

    await page.goto('/pricing/student');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(PRICING.title);
    await expect(page.getByText(PRICING.subtitle, { exact: true })).toBeVisible();

    const cards = planCards(page);
    await expect(cards).toHaveCount(plans.length);

    for (const [index, plan] of plans.entries()) {
      const card = cards.nth(index);
      await expect(card.locator('[data-slot="card-title"]')).toHaveText(plan.name);

      // Price: stored in grosze, rendered in the plan currency.
      const priceLine = normalize(
        await card.locator('[data-slot="card-content"] > div').first().innerText(),
      );
      const expectedPrice =
        normalize(formatPrice(plan)) + (plan.priceMonthly > 0 ? PRICING.period_month : '');
      expect(priceLine, `price for ${plan.key}`).toBe(expectedPrice);

      // Features: human labels only, one per configured feature.
      const labels = (await card.locator('ul li').allInnerTexts()).map(normalize);
      expect(labels.length, `feature count for ${plan.key}`).toBeGreaterThan(0);
      expect([...labels].sort(), `features for ${plan.key}`).toEqual(
        plan.features.map(featureLabel).map(normalize).sort(),
      );
      for (const label of labels) {
        expect(label, `raw or missing feature label on ${plan.key}`).not.toMatch(
          /^(PricingPage\.|feature_)|undefined|NaN/,
        );
      }

      // CTA: per-plan copy; a signed-out visitor is sent to registration.
      const cta = card.locator('[data-slot="button"]');
      await expect(cta).toHaveText(PRICING[CTA_MESSAGE_KEY[plan.key]]);
      expect(await cta.evaluate((element) => element.tagName), `CTA element for ${plan.key}`).toBe(
        'A',
      );
      await expect(cta).toHaveAttribute('href', '/register');

      // Only the configured "popular" plan (Ace for students) is highlighted.
      const popular = card.locator('[data-slot="badge"]', { hasText: PRICING.most_popular });
      await expect(popular).toHaveCount(plan.key === 'ace' ? 1 : 0);
    }

    // Limits: readable values, -1 rendered as "Bez ograniczeń".
    await expect(page.getByRole('heading', { name: PRICING.comparison_title })).toBeVisible();
    const table = page.locator('table');
    await expect(table).toBeVisible();

    const headerCells = table.locator('thead th');
    await expect(headerCells).toHaveCount(plans.length + 1);
    for (const [index, plan] of plans.entries()) {
      await expect(headerCells.nth(index + 1)).toHaveText(plan.name);
    }

    const rows = table.locator('tbody tr');
    const rowCount = await rows.count();
    const rowLabels = await Promise.all(
      Array.from({ length: rowCount }, (_, index) =>
        rows.nth(index).locator('td').first().innerText(),
      ),
    );
    const normalizedLabels = rowLabels.map(normalize);

    for (const limitKey of STUDENT_LIMIT_KEYS) {
      const label = normalize(PRICING[`limit_${limitKey}`]);
      const rowIndex = normalizedLabels.indexOf(label);
      expect(rowIndex, `comparison row "${label}"`).toBeGreaterThanOrEqual(0);

      const cells = rows.nth(rowIndex).locator('td');
      for (const [column, plan] of plans.entries()) {
        const expected =
          limitKey in plan.limits ? formatLimit(limitKey, plan.limits[limitKey]) : '—';
        const actual = normalize(await cells.nth(column + 1).innerText());
        expect(actual, `${limitKey} on ${plan.key}`).toBe(expected);
      }
    }

    // Seats/groups are org-only: a student comparison must not render them.
    for (const limitKey of ORG_ONLY_LIMIT_KEYS) {
      expect(normalizedLabels).not.toContain(normalize(PRICING[`limit_${limitKey}`]));
    }
  });

  test('marks the signed-in student’s current plan and turns paid CTAs into checkout buttons', async ({
    page,
  }) => {
    const tenant = loadQaTenant('PUB-04');
    await signInAs(page, tenant, 'student');

    const plans = await fetchStudentPlans(page);

    const currentResponse = await page.request.get('/api/v1/me/personal-plan');
    expect(currentResponse.status()).toBe(200);
    const current = ((await currentResponse.json()) as { data: PlanInfo }).data;
    expect(STUDENT_PLAN_KEYS).toContain(current.key as (typeof STUDENT_PLAN_KEYS)[number]);

    await page.goto('/pricing/student');
    await expect(page.getByText(PRICING.current_plan_badge)).toHaveCount(1);

    const cards = planCards(page);
    await expect(cards).toHaveCount(plans.length);

    for (const [index, plan] of plans.entries()) {
      const card = cards.nth(index);
      await expect(card.locator('[data-slot="card-title"]')).toHaveText(plan.name);

      const currentBadge = card.locator('[data-slot="badge"]', {
        hasText: PRICING.current_plan_badge,
      });
      await expect(currentBadge).toHaveCount(plan.key === current.key ? 1 : 0);

      const cta = card.locator('[data-slot="button"]');
      await expect(cta).toHaveText(PRICING[CTA_MESSAGE_KEY[plan.key]]);

      if (plan.key === 'base') {
        // The free plan never goes through checkout: it links into the app.
        expect(await cta.evaluate((element) => element.tagName)).toBe('A');
        await expect(cta).toHaveAttribute('href', '/app');
      } else {
        // Paid plans open the (simulated) checkout flow for this user.
        expect(await cta.evaluate((element) => element.tagName)).toBe('BUTTON');
      }

      // The popular highlight is independent of the current-plan badge.
      const popular = card.locator('[data-slot="badge"]', { hasText: PRICING.most_popular });
      await expect(popular).toHaveCount(plan.key === 'ace' ? 1 : 0);
    }
  });
});
