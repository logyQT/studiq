import { expect, test, type Locator, type Page } from '@playwright/test';
import pl from '@/i18n/messages/pl.json';
import { createTranslator } from 'next-intl';
import { json } from '#test/helpers/json';
import { loadTenant, loginAs, type QaRole } from '#test/qa/fixtures/tenant';

/**
 * BIL-02 — the „Wybierz plan” pages: `/app/upgrade` (student) and `/edu/upgrade`
 * (educator).
 *
 * Prerequisite (reconciled with the tenant seeder): one signed-in **student** and
 * one signed-in **educator**. The case was written against the legacy manual seed
 * (`student1@dev.local` / `teacher1@dev.local`, password `pass`); the suite version
 * uses this case's own tenant and never the legacy accounts.
 *
 * Tenant (`content` profile — org + manager/teacher/student + group `G1`, declared in
 * `__tests__/qa/profiles/BIL-02.json`), fresh run suffix per independent run:
 *
 *   bun scripts/qa-tenant.ts BIL-02 --fresh
 *
 * gives `qa-bil-02-<suffix>` (`tenantKey('qa/cases/BIL-02.md', 'BIL-02#<suffix>',
 * 'qa-shared')` + `tenantId` for every org/user/group id). The tenant's `student` is
 * an org member without a seat assignment, so `/api/v1/me/personal-plan` resolves
 * their **personal** plan — `profiles.personal_plan_key`, default `base`. The
 * tenant's `teacher` is an educator account with no seat assignment either, so
 * `/api/v1/me/plan` falls back to the same personal plan — `lite`, the educator free
 * tier the `handle_new_user` trigger writes for `account_type = educator`. That is
 * the „plan Base” / „plan Lite” the case's two legs start from.
 *
 * Walk observation (shared app, pl): both pages render the same shell — heading
 * „Rozwiń swój plan”, subtitle „Wybierz plan odpowiedni dla Twoich potrzeb”, then one
 * four-column grid of plan cards. `/app/upgrade` shows exactly the student catalogue
 * (StudiQ Base, Spark, Ace, Pro), `/edu/upgrade` exactly the educator catalogue
 * (StudiQ Lite, Guide, Creator, Master). In both, the current plan's card carries the
 * „Obecny Plan” badge and every other card a purchase/selection button
 * („Wybierz Spark”, „Wybierz Ace”, „Wybierz Pro” / „Wybierz Guide”,
 * „Wybierz Creator”, „Wybierz Master”). „Wybierz Spark” opens
 * `/checkout?session_id=…&plan_id=spark`. A student opening `/edu/upgrade` keeps
 * the URL and sees the educator catalogue, and an educator opening `/app/upgrade`
 * sees the student catalogue: `/app` and `/edu` are auth-only areas (ADR-0015
 * §7.1), so neither page redirects. The audience boundary is the checkout, which
 * refuses a personal plan whose `audience` is not the caller's account type
 * (`FORBIDDEN`, 403): the student cannot buy an educator plan, and the purchase
 * control reports the refusal without leaving the page.
 *
 * Asserted behaviour (the case's expected result):
 * - the student page lists the student plans, the educator page the educator plans,
 *   each in the catalogue's order and with the catalogue's names;
 * - the current plan (Base / Lite) is marked with exactly one „Obecny Plan” badge;
 * - every other plan exposes its purchase/selection button, enabled;
 * - each page shows only its own account type's plans;
 * - the purchase button really starts a checkout for that plan.
 *
 * Adjacent regression that matters for this surface: the route loads for either
 * account type, while the plan audience is enforced by the catalogue each page
 * renders and by the checkout that refuses the other audience's plan.
 *
 * Read-only shared data: the plan catalogue (`subscription_plans`, `plan_limits`) is
 * global; the spec reads it through the API and asserts the page renders it. Nothing
 * global is written — the only write is the checkout session the purchase button
 * creates for this tenant's own student.
 */

const CASE = 'BIL-02';

/**
 * The page copy, read from the catalogues the two upgrade pages render from: the
 * shared shell is `UpgradePage`, the plan cards are `PricingPage`. The spec pins
 * the catalogue's plans and the badge/control each one carries, not the wording.
 * Plan names come from the plan catalogue over the API, so they stay data.
 */
const upgradeCopy = createTranslator({ locale: 'pl', messages: pl, namespace: 'UpgradePage' });
const pricingCopy = createTranslator({ locale: 'pl', messages: pl, namespace: 'PricingPage' });
const checkoutCopy = createTranslator({ locale: 'pl', messages: pl, namespace: 'CheckoutPage' });

const UPGRADE_COPY = {
  title: upgradeCopy('title'),
  subtitle: upgradeCopy('subtitle'),
} as const;

const CURRENT_BADGE = pricingCopy('current_plan_badge');
/** The toast `CheckoutButton` shows when the checkout refuses the purchase. */
const PAYMENT_FAILED = checkoutCopy('payment_failed');

/** The student plans the case names, in catalogue order. */
const STUDENT_PLAN_NAMES = ['StudiQ Base', 'StudiQ Spark', 'StudiQ Ace', 'StudiQ Pro'] as const;
/** The educator plans the case names, in catalogue order. */
const EDUCATOR_PLAN_NAMES = [
  'StudiQ Lite',
  'StudiQ Guide',
  'StudiQ Creator',
  'StudiQ Master',
] as const;

/** Plan key → the purchase/selection label `PlanCard` renders for it. */
const PLAN_CTA: Record<string, string> = {
  base: pricingCopy('cta_free'),
  spark: pricingCopy('cta_spark'),
  ace: pricingCopy('cta_ace'),
  pro: pricingCopy('cta_pro'),
  lite: pricingCopy('cta_free'),
  guide: pricingCopy('cta_guide'),
  creator: pricingCopy('cta_creator'),
  master: pricingCopy('cta_master'),
};

interface PlanInfo {
  key: string;
  name: string;
  priceMonthly: number;
  scope: string;
  audience: string | null;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

function account(role: QaRole) {
  const tenant = loadTenant(CASE);
  const user = tenant.users[role];
  if (!user) {
    throw new Error(
      `BIL-02 fixture incomplete: no ${role}. Run \`bun scripts/qa-tenant.ts ${CASE} --fresh\``,
    );
  }
  return { tenant, user };
}

/** The personal plan catalogue for one audience, as the page's own API returns it. */
async function fetchPlans(page: Page, audience: 'student' | 'educator'): Promise<PlanInfo[]> {
  const response = await page.request.get(
    `/api/v1/subscription-plans?scope=personal&audience=${audience}`,
  );
  expect(
    response.status(),
    `GET /api/v1/subscription-plans?scope=personal&audience=${audience}`,
  ).toBe(200);
  const body = await json<ApiEnvelope<PlanInfo[]>>(response);
  expect(body.success, `plans response for ${audience}`).toBe(true);
  return body.data;
}

/** The plan the caller is on (`/me/personal-plan` for students, `/me/plan` otherwise). */
async function fetchCurrentPlan(
  page: Page,
  endpoint: '/api/v1/me/personal-plan' | '/api/v1/me/plan',
): Promise<PlanInfo> {
  const response = await page.request.get(endpoint);
  expect(response.status(), `GET ${endpoint}`).toBe(200);
  const body = await json<ApiEnvelope<PlanInfo>>(response);
  expect(body.success, `${endpoint} response`).toBe(true);
  return body.data;
}

function planCards(page: Page): Locator {
  return page.locator('[data-slot="card"]');
}

/** The plan card whose title is exactly `name`. */
function planCard(page: Page, name: string): Locator {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return planCards(page).filter({
    has: page.locator('[data-slot="card-title"]', { hasText: new RegExp(`^${escaped}$`) }),
  });
}

/** Asserts the shared shell every upgrade page renders. */
async function expectUpgradeShell(page: Page): Promise<void> {
  await expect(
    page.getByRole('heading', { level: 1, name: UPGRADE_COPY.title, exact: true }),
  ).toBeVisible();
  await expect(page.getByText(UPGRADE_COPY.subtitle, { exact: true })).toBeVisible();
}

/**
 * The plan grid: the catalogue's plans in its order, the current plan marked with the
 * single „Obecny Plan” badge, and a working purchase/selection control on every other
 * plan.
 */
async function expectPlanGrid(
  page: Page,
  plans: PlanInfo[],
  expectedNames: readonly string[],
  currentPlan: PlanInfo,
): Promise<void> {
  expect(
    plans.map((plan) => plan.name),
    'the page renders the catalogue for this account type',
  ).toEqual([...expectedNames]);

  await expect(planCards(page)).toHaveCount(expectedNames.length);
  await expect
    .poll(async () => planCards(page).locator('[data-slot="card-title"]').allInnerTexts(), {
      message: 'plan cards keep the catalogue order',
    })
    .toEqual([...expectedNames]);

  // Exactly one plan is marked current, and it is the one the plan API resolves.
  await expect(page.getByText(CURRENT_BADGE, { exact: true })).toHaveCount(1);
  const currentCard = planCard(page, currentPlan.name);
  await expect(currentCard).toHaveCount(1);
  await expect(currentCard.locator('[data-slot="card-title"]')).toHaveText(currentPlan.name);
  await expect(currentCard.getByText(CURRENT_BADGE, { exact: true })).toBeVisible();

  // Every other plan offers its purchase/selection control and is not marked current.
  for (const plan of plans) {
    const card = planCard(page, plan.name);
    await expect(card, `card ${plan.name}`).toHaveCount(1);
    const cta = PLAN_CTA[plan.key];
    expect(cta, `the case's copy for ${plan.key}`).toBeDefined();
    if (plan.key === currentPlan.key) continue;
    await expect(card.getByText(CURRENT_BADGE, { exact: true })).toHaveCount(0);
    const button = card.getByRole('button', { name: cta, exact: true });
    await expect(button, `purchase control for ${plan.name}`).toBeVisible();
    await expect(button, `purchase control for ${plan.name} is enabled`).toBeEnabled();
  }
}

test.describe('@case:BIL-02 @area:BIL @prio:P2 upgrade pages', () => {
  test('a student sees the student plans and Base is marked as the current plan', async ({
    page,
  }) => {
    const { tenant } = account('student');
    console.log(`BIL-02 tenant key: ${tenant.key}`);

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // --- Prerequisite: the tenant's student, signed in, Polish UI --------------
    await loginAs(page, tenant, 'student', { locale: 'pl' });
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

    const plans = await fetchPlans(page, 'student');
    for (const plan of plans) {
      expect(plan.scope, `plan ${plan.key} is personal-scope`).toBe('personal');
      expect(plan.audience, `plan ${plan.key} belongs to students`).toBe('student');
    }
    const currentPlan = await fetchCurrentPlan(page, '/api/v1/me/personal-plan');
    expect(currentPlan.key, 'the seeded student starts on the free Base plan').toBe('base');

    // --- Step 1: /app/upgrade -------------------------------------------------
    await page.goto('/app/upgrade');
    await expectUpgradeShell(page);
    await expectPlanGrid(page, plans, STUDENT_PLAN_NAMES, currentPlan);

    // A student page must not leak the educator catalogue.
    for (const name of EDUCATOR_PLAN_NAMES) {
      await expect(page.getByText(name, { exact: true }), `${name} must stay hidden`).toHaveCount(
        0,
      );
    }

    // The purchase button starts a checkout for that very plan.
    await planCard(page, 'StudiQ Spark')
      .getByRole('button', { name: PLAN_CTA.spark, exact: true })
      .click();
    await page.waitForURL(/\/checkout\?/, { timeout: 20_000 });
    expect(new URL(page.url()).searchParams.get('plan_id'), 'the checkout targets Spark').toBe(
      'spark',
    );
    await expect(page.getByText('Podsumowanie zamówienia', { exact: true })).toBeVisible();
    await expect(page.getByText('StudiQ Spark', { exact: true }).first()).toBeVisible();

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });

  test('an educator sees the educator plans and Lite is marked as the current plan', async ({
    page,
  }) => {
    const { tenant } = account('teacher');
    console.log(`BIL-02 tenant key: ${tenant.key}`);

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // --- Prerequisite: the tenant's educator, signed in, Polish UI ------------
    await loginAs(page, tenant, 'teacher', { locale: 'pl' });
    await expect(page).toHaveURL(/\/edu$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

    const plans = await fetchPlans(page, 'educator');
    for (const plan of plans) {
      expect(plan.scope, `plan ${plan.key} is personal-scope`).toBe('personal');
      expect(plan.audience, `plan ${plan.key} belongs to educators`).toBe('educator');
    }
    // Unseated educator: `/me/plan` falls back to the personal plan the trigger wrote.
    const currentPlan = await fetchCurrentPlan(page, '/api/v1/me/plan');
    expect(currentPlan.key, 'the seeded educator starts on the free Lite plan').toBe('lite');

    // --- Step 2: /edu/upgrade ------------------------------------------------
    await page.goto('/edu/upgrade');
    await expectUpgradeShell(page);
    await expectPlanGrid(page, plans, EDUCATOR_PLAN_NAMES, currentPlan);

    // An educator page must not leak the student catalogue.
    for (const name of STUDENT_PLAN_NAMES) {
      await expect(page.getByText(name, { exact: true }), `${name} must stay hidden`).toHaveCount(
        0,
      );
    }

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });

  test('each plan page loads for either account type, but only its own audience can buy', async ({
    page,
    browser,
    baseURL,
  }) => {
    const { tenant } = account('student');

    // Area routes are auth-only (ADR-0015 §7.1): a student may open the educator
    // plan page and keeps the URL. What is gated is the audience, not the route.
    await loginAs(page, tenant, 'student', { locale: 'pl' });
    await expect(page).toHaveURL(/\/app$/);
    await page.goto('/edu/upgrade');
    await expect(page).toHaveURL(/\/edu\/upgrade$/);
    await expectUpgradeShell(page);
    await expect(planCards(page), 'the educator catalogue renders for the route').toHaveCount(
      EDUCATOR_PLAN_NAMES.length,
    );

    // The checkout resolves the plan's audience against the caller, so the
    // educator catalogue is not purchasable by a student.
    const denied = await page.request.post('/api/v1/stripe/create-checkout-session', {
      data: { planKey: 'guide', locale: 'pl' },
    });
    expect(denied.status(), 'a student checking out an educator plan').toBe(403);
    expect(await denied.json(), 'the refusal envelope').toEqual({
      success: false,
      error: 'FORBIDDEN',
    });

    // The purchase control surfaces that refusal and never navigates to checkout.
    await planCard(page, 'StudiQ Guide')
      .getByRole('button', { name: PLAN_CTA.guide, exact: true })
      .click();
    await expect(
      page.locator('[data-sonner-toast]').filter({ hasText: PAYMENT_FAILED }),
      'the refused purchase is reported to the student',
    ).toBeVisible();
    await expect(page).toHaveURL(/\/edu\/upgrade$/);

    // The mirror case: an educator may open the student page and cannot buy it.
    const context = await browser.newContext({ baseURL: baseURL ?? 'http://localhost:3010' });
    try {
      const educatorPage = await context.newPage();
      await loginAs(educatorPage, tenant, 'teacher', { locale: 'pl' });
      await expect(educatorPage).toHaveURL(/\/edu$/);
      await educatorPage.goto('/app/upgrade');
      await expect(educatorPage).toHaveURL(/\/app\/upgrade$/);
      await expectUpgradeShell(educatorPage);
      await expect(
        planCards(educatorPage),
        'the student catalogue renders for the route',
      ).toHaveCount(STUDENT_PLAN_NAMES.length);

      const educatorDenied = await educatorPage.request.post(
        '/api/v1/stripe/create-checkout-session',
        { data: { planKey: 'spark', locale: 'pl' } },
      );
      expect(educatorDenied.status(), 'an educator checking out a student plan').toBe(403);
      expect(await educatorDenied.json(), 'the refusal envelope').toEqual({
        success: false,
        error: 'FORBIDDEN',
      });
    } finally {
      await context.close();
    }
  });
});
