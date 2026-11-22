import { json } from '#test/helpers/json';
import pl from '@/i18n/messages/pl.json';
import { expect, test, type Page } from '@playwright/test';
import { createTranslator } from 'next-intl';

/**
 * PUB-04 — Strona „Cennik” (/pricing) – plany dla uczniów i studentów.
 *
 * Mapping note (the redesign, `feat/pricing-design-system`): the case was written
 * for `/pricing/student`, a page of plan cards. That route is gone; the individual
 * audience of `/pricing` now prints the student ladder as a price list (one `<li>`
 * per plan with its `h3#<key>` handle), one differences-only comparison table below
 * it, and the FAQ. The case ID and its acceptance intent — every configured student
 * plan, its price, its limits and its CTA, with „Zalecany” on one plan —
 * are unchanged.
 *
 * Prerequisite "Brak sesji": the pricing page is public, so the spec runs with an
 * empty storage state and never signs in. PUB-04's isolated tenant
 * (`qa/cases/PUB-04.md::PUB-04::qa-shared`, seeded with
 * `bun scripts/qa-tenant.ts PUB-04`) exists per case but is deliberately not used
 * for a session — the acceptance criteria belong to the anonymous visitor.
 *
 * The plan catalogue is shared, mutable product config (QA-SUITE-APPROACH hard
 * limits), so the spec reads it through the public
 * `GET /api/v1/subscription-plans` endpoint and asserts that the page renders
 * *that* configuration: plan names, order, grosze → PLN price formatting, which
 * features differ between the plans, and the `-1` → `∞` / `0` → `—` limit
 * formatting. Page copy comes from the `PricingPage` catalogue the page renders
 * from, so a rewording does not turn the spec red.
 */

const CASE = 'PUB-04';

const copy = createTranslator({ locale: 'pl', messages: pl, namespace: 'PricingPage' });

interface PlanInfo {
  key: string;
  name: string;
  priceMonthly: number;
  currency: string;
  features: string[];
  limits: Record<string, number>;
  sortOrder: number;
  isActive: boolean;
  scope: string;
  audience: string | null;
}

/** The student ladder the public pricing page documents (`base` … `pro`). */
const STUDENT_PLAN_KEYS = ['base', 'spark', 'ace', 'pro'] as const;

/** The student plan the page recommends to this ladder. */
const RECOMMENDED_PLAN = 'ace';

/** The individual FAQ, in the order the page asks it. */
const FAQ_PAIRS = [
  ['faq_q1', 'faq_a1'],
  ['faq_q2', 'faq_a2'],
  ['faq_q3', 'faq_a3'],
  ['faq_q_ind_1', 'faq_a_ind_1'],
  ['faq_q_ind_2', 'faq_a_ind_2'],
] as const;

const UNLIMITED = '∞';
const ABSENT = '—';

/** Comparison-row order the page documents (`apps/web/src/lib/pricing-limits.ts`). */
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

/** `StudiQ Ace` → `Ace`: the page names the tier in its own column. */
function shortPlanName(name: string): string {
  return name.replace(/^StudiQ\s+/i, '').trim();
}

/** A feature key's label, read from the `feature_*` messages the table renders. */
function featureLabel(key: string): string {
  const messageKey = `feature_${key.replace(/[.\s-]+/g, '_')}`;
  if (copy.has(messageKey)) return copy(messageKey);
  const words = key.replace(/[.\s-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A limit key's label; a gap here is a spec bug, not a render bug. */
function limitLabel(key: string): string {
  const messageKey = `limit_${key}`;
  if (!copy.has(messageKey)) throw new Error(`${CASE} has no copy for ${messageKey}`);
  return copy(messageKey);
}

/** "9,99 zł" → 9.99 (the price is stored in grosze and must be divided by 100). */
function moneyValue(amount: string): number {
  return Number(amount.replace(/zł/gi, '').replace(/\s/g, '').replace(',', '.'));
}

/**
 * What a limit cell must print: `-1` is the catalogue's "unlimited", a cap of `0`
 * (or a missing key) is "not offered", and a number is grouped in the locale.
 */
function printLimit(value: number | undefined): string {
  if (value === undefined || value === 0) return ABSENT;
  if (value < 0) return UNLIMITED;
  return new Intl.NumberFormat('pl').format(value);
}

/** Features carried by some plans only, sorted the way the table sorts them. */
function differingFeatures(plans: PlanInfo[]): string[] {
  const carriers = new Map<string, number>();
  for (const plan of plans) {
    for (const feature of plan.features) {
      carriers.set(feature, (carriers.get(feature) ?? 0) + 1);
    }
  }
  return [...carriers.keys()].filter((key) => carriers.get(key) !== plans.length).toSorted();
}

/** Features every plan carries — printed once above the table, in label order. */
function commonFeatures(plans: PlanInfo[]): string[] {
  const union = new Set(plans.flatMap((plan) => plan.features));
  return [...union]
    .filter((feature) => plans.every((plan) => plan.features.includes(feature)))
    .toSorted();
}

/** Limits the ladder can show and whose printed value is not the same everywhere. */
function differingLimits(plans: PlanInfo[]): string[] {
  return SORTED_LIMIT_KEYS.filter(
    (key) => !ORG_ONLY_LIMIT_KEYS.includes(key) && plans.some((plan) => key in plan.limits),
  ).filter((key) => new Set(plans.map((plan) => printLimit(plan.limits[key]))).size > 1);
}

/** Collect browser-side failures so "the page loads without errors" is asserted. */
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

async function fetchStudentPlans(page: Page): Promise<PlanInfo[]> {
  const response = await page.request.get('/api/v1/subscription-plans');
  expect(response.status(), 'the public plan catalogue').toBe(200);
  const { data } = await json<{ data: PlanInfo[] }>(response);
  return data
    .filter((plan) => plan.isActive && plan.scope === 'personal' && plan.audience === 'student')
    .toSorted((a, b) => a.sortOrder - b.sortOrder);
}

/** The student ladder section: the plan list, its comparison table and its caption. */
function studentLadder(page: Page) {
  return page
    .locator('#pricing-plans section')
    .filter({ has: page.getByRole('heading', { level: 2, name: copy('ladder_student_title') }) });
}

/** The `<li>` of one plan, addressed by the `h3` handle the page gives it. */
function planRow(page: Page, key: string) {
  return page.locator('#pricing-plans li').filter({ has: page.locator(`h3#${key}`) });
}

test.describe('@case:PUB-04 @area:PUB @prio:P2 student ladder, comparison and FAQ', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ context, baseURL }) => {
    // A returning Polish visitor: the suite asserts Polish copy, so pin the locale
    // so a stale profile cookie can never switch it under the assertions.
    const { hostname } = new URL(baseURL!);
    await context.addCookies([{ name: 'NEXT_LOCALE', value: 'pl', domain: hostname, path: '/' }]);
  });

  test('renders the student price list, its comparison table and the FAQ from the catalogue', async ({
    page,
  }) => {
    const errors = watchForErrors(page);

    // Step 1 — open the page directly, as an anonymous visitor.
    const response = await page.goto('/pricing');
    expect(response?.status(), 'document status').toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
    await expect(page).toHaveTitle(`${copy('title')} | StudiQ`);

    // Prerequisite "Brak sesji": no user, so no „Twój plan” and no checkout CTA.
    const me = await page.request.get('/api/v1/auth/me');
    expect(me.status()).toBe(200);
    const meBody = await json<{ data?: { user?: unknown } }>(me);
    expect(meBody.data?.user ?? null).toBeNull();

    await expect(
      page.getByRole('heading', { level: 1, name: copy('title'), exact: true }),
    ).toBeVisible();

    const plans = await fetchStudentPlans(page);
    expect(
      plans.map((plan) => plan.key),
      'the student ladder is Base, Spark, Ace and Pro',
    ).toEqual([...STUDENT_PLAN_KEYS]);

    // Step 2 — one row per configured plan, in catalogue order, with the name,
    // the price, the description and a registration action.
    const ladder = studentLadder(page);
    await expect(
      ladder.getByRole('heading', { level: 2, name: copy('ladder_student_title'), exact: true }),
    ).toBeVisible();
    await expect(ladder.locator('ul > li')).toHaveCount(plans.length);

    for (const plan of plans) {
      const row = planRow(page, plan.key);
      await expect(row, `one row for ${plan.key}`).toHaveCount(1);

      // The row's handle is the plan's own name, under the ladder it belongs to.
      await expect(row.locator(`h3#${plan.key}`)).toHaveText(shortPlanName(plan.name));

      // Price: the configured grosze value rendered as PLN, e.g. 999 → "9,99 zł".
      const priceLine = (await row.locator('p').first().innerText())
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (plan.priceMonthly === 0) {
        expect(priceLine, `${plan.key} free plan price`).toBe(copy('price_free'));
      } else {
        const priceMatch = /^(?<amount>[\d\s.,]+zł)(?<period>\/miesiąc)?$/.exec(priceLine);
        expect(priceMatch, `${plan.key} price line "${priceLine}"`).not.toBeNull();
        const amount = priceMatch?.groups?.amount;
        if (!amount)
          throw new Error(`${CASE} ${plan.key} price line has no amount: "${priceLine}"`);
        expect(moneyValue(amount), `${plan.key} price from grosze`).toBe(plan.priceMonthly / 100);
        // A paid plan is sold per month and keeps the grosze decimals.
        expect(priceMatch.groups?.period, `${plan.key} billing period`).toBe('/miesiąc');
        if (plan.priceMonthly % 100 !== 0) {
          expect(amount, `${plan.key} grosze are shown`).toMatch(/,\d{2}\s*zł$/);
        }
      }

      // The description is copy, not a leftover key.
      const description = copy.has(`plan_${plan.key}_desc`) ? copy(`plan_${plan.key}_desc`) : null;
      if (description) await expect(row.getByText(description, { exact: true })).toBeVisible();

      // CTA: one link per row, pointing an anonymous visitor at registration.
      const cta = row.getByRole('link');
      await expect(cta, `${plan.key} CTA`).toHaveCount(1);
      await expect(cta).toHaveText(
        plan.priceMonthly === 0 ? copy('cta_free') : copy('cta_register'),
      );
      await expect(cta).toHaveAttribute('href', '/register');
    }

    // „Zalecany” marks exactly the documented recommended plan, once.
    await expect(ladder.getByText(copy('recommended_badge'), { exact: true })).toHaveCount(1);
    await expect(
      planRow(page, RECOMMENDED_PLAN).getByText(copy('recommended_badge'), { exact: true }),
    ).toBeVisible();

    // Step 3 — the differences-only comparison table for this ladder.
    const table = ladder.locator('table');
    await expect(table, 'one comparison table for the student ladder').toHaveCount(1);

    const caption = copy('comparison_caption_student');
    await expect(table.locator('caption')).toHaveText(caption);
    // The scrollable region is named and focusable, so a truncated reading stays
    // keyboard-navigable (it is the table's container, whatever it scrolls to).
    const region = table.locator('xpath=..');
    await expect(region).toHaveAttribute('aria-label', caption);
    await expect(region).toHaveAttribute('tabindex', '0');

    await expect(
      ladder.getByRole('heading', { level: 3, name: copy('comparison_title') }),
    ).toBeVisible();

    const columnHeaders = (await table.locator('th[scope="col"]').allTextContents()).map((header) =>
      header.trim(),
    );
    expect(columnHeaders, 'the first column is the feature name').toEqual([
      copy('comparison_feature'),
      ...plans.map((plan) => shortPlanName(plan.name)),
    ]);

    // "All plans include" — the intersection, printed once instead of as N rows.
    const common = commonFeatures(plans);
    const included = new Intl.ListFormat('pl', { style: 'long', type: 'conjunction' }).format(
      common.map(featureLabel),
    );
    await expect(
      ladder.getByText(copy('comparison_all_include', { features: included }), { exact: true }),
    ).toBeVisible();

    const features = differingFeatures(plans);
    const limits = differingLimits(plans);
    const rows = table.locator('tbody tr');
    await expect(rows, 'one row per differing feature and limit').toHaveCount(
      features.length + limits.length,
    );

    const rowLabels = (await rows.locator('th[scope="row"]').allTextContents()).map((label) =>
      label.trim(),
    );
    expect(rowLabels).toEqual([...features.map(featureLabel), ...limits.map(limitLabel)]);

    // A differing feature row: the plans that carry it show the check, the plans
    // that do not show the absence mark.
    for (const [offset, feature] of features.entries()) {
      const row = rows.nth(offset);
      for (const [index, plan] of plans.entries()) {
        const cell = row.locator('td').nth(index);
        const carried = plan.features.includes(feature);
        await expect(cell.locator('svg.lucide-check'), `${plan.key} × ${feature}`).toHaveCount(
          carried ? 1 : 0,
        );
        if (!carried) {
          await expect(
            cell.locator('span[aria-hidden="true"]'),
            `${plan.key} × ${feature} absence mark`,
          ).toHaveText(ABSENT);
        }
      }
    }

    // A limit row: every cell is the configured value, with `-1` printed as the
    // unlimited glyph and a cap the plan does not offer printed as an em dash.
    for (const [offset, key] of limits.entries()) {
      const row = rows.nth(features.length + offset);
      await expect(row.locator('th[scope="row"]')).toHaveText(limitLabel(key));
      for (const [index, plan] of plans.entries()) {
        // The printed value is the cell's first span; the spoken form (`Bez
        // ograniczeń` / `Nie`) is the extra, screen-reader-only span beside it.
        await expect(
          row.locator('td').nth(index).locator('span').first(),
          `${plan.key} ${key}`,
        ).toHaveText(printLimit(plan.limits[key]));
      }
    }
    // The ladder really does exercise both glyphs, not only plain numbers.
    const printedLimits = await table
      .locator('tbody tr')
      .evaluateAll((tableRows) =>
        tableRows.flatMap((row) =>
          Array.from(row.querySelectorAll('td span[aria-hidden="true"]')).map((cell) =>
            cell.textContent.trim(),
          ),
        ),
      );
    expect(printedLimits, 'an uncapped plan prints ∞').toContain(UNLIMITED);
    expect(printedLimits, 'a plan without a cap prints —').toContain(ABSENT);

    // Step 4 — the FAQ: collapsed on load, single-open, answers still in the DOM.
    await expect(
      page.getByRole('heading', { level: 2, name: copy('faq_title'), exact: true }),
    ).toBeVisible();

    const panels: string[] = [];
    for (const [index, [question, answer]] of FAQ_PAIRS.entries()) {
      const trigger = page.getByRole('button', { name: copy(question), exact: true });
      await expect(
        page.getByRole('heading', { level: 3, name: copy(question), exact: true }),
        `the question is an h3 (${index})`,
      ).toBeVisible();
      await expect(trigger, `${question} starts collapsed`).toHaveAttribute(
        'aria-expanded',
        'false',
      );

      const panelId = await trigger.getAttribute('aria-controls');
      if (!panelId) throw new Error(`${CASE} ${question} trigger has no aria-controls`);
      panels.push(panelId);
      const panel = page.locator(`#${panelId}`);
      await expect(panel, `${question} answer is not visible`).toBeHidden();
      // The answer stays in the document for search engines and no-JS readers.
      await expect(panel).toHaveText(copy(answer));
    }

    const [firstPanel, secondPanel] = panels;
    const firstTrigger = page.getByRole('button', { name: copy(FAQ_PAIRS[0][0]), exact: true });
    const secondTrigger = page.getByRole('button', { name: copy(FAQ_PAIRS[1][0]), exact: true });
    if (!firstPanel || !secondPanel) throw new Error(`${CASE} has no FAQ panels`);

    await secondTrigger.click();
    await expect(page.locator(`#${secondPanel}`)).toBeVisible();
    await expect(secondTrigger).toHaveAttribute('aria-expanded', 'true');

    // Opening another question closes the one that was open: the group is `single`.
    await firstTrigger.click();
    await expect(page.locator(`#${firstPanel}`)).toBeVisible();
    await expect(page.locator(`#${secondPanel}`)).toBeHidden();
    await expect(secondTrigger).toHaveAttribute('aria-expanded', 'false');

    // No raw translation keys or missing values on the page.
    const body = await page.locator('#pricing-plans').innerText();
    expect(body, 'raw translation keys').not.toMatch(/\b(?:PricingPage|Common)\.[A-Za-z_]+/);
    expect(body, 'literal undefined').not.toMatch(/\bundefined\b/);
    expect(body, 'literal NaN').not.toMatch(/\bNaN\b/);

    // Adjacent regression: a reload renders the same catalogue, so no pricing
    // state lives only in the first client render.
    await page.reload();
    await expect(planRow(page, STUDENT_PLAN_KEYS[0])).toHaveCount(1);
    await expect(studentLadder(page).locator('ul > li')).toHaveCount(plans.length);

    errors.expectClean();
  });
});
