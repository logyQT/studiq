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
 * `/api/v1/me/plan` falls back to the same personal plan — `base`, the one free
 * tier `handle_new_user` writes for every persona since #1193. That is the
 * „StudiQ Free” plan both legs start from.
 *
 * Walk observation (shared app, pl): both pages render the same shell — heading
 * „Rozwiń swój plan”, subtitle „Wybierz plan odpowiedni dla Twoich potrzeb”, then one
 * four-column grid of plan cards. `/app/upgrade` and `/edu/upgrade` both show the one
 * individual catalogue (StudiQ Free, Plus, Pro, Max). In both, the current plan's
 * card carries the „Obecny Plan” badge and every other card a purchase/selection
 * button („Wybierz Plus”, „Wybierz Pro”, „Wybierz Maks”). „Wybierz Plus” opens
 * `/checkout?session_id=…&plan_id=spark`. `/app` and `/edu` are auth-only areas
 * (ADR-0015 §7.1), so a student opening `/edu/upgrade` keeps the URL and sees the
 * same ladder; persona no longer filters a personal purchase.
 *
 * Asserted behaviour (the case's expected result):
 * - both pages list the one individual ladder in the catalogue's order, with the
 *   catalogue's names;
 * - the current plan (Free) is marked with exactly one „Obecny Plan” badge;
 * - every other plan exposes its purchase/selection button, enabled;
 * - the purchase button really starts a checkout for that plan.
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

const UPGRADE_COPY = {
  title: upgradeCopy('title'),
  subtitle: upgradeCopy('subtitle'),
} as const;

const CURRENT_BADGE = pricingCopy('current_plan_badge');

/** The individual plans the case names, in catalogue order. */
const PLAN_NAMES = ['StudiQ Free', 'StudiQ Plus', 'StudiQ Pro', 'StudiQ Max'] as const;

/** Plan key → the purchase/selection label `PlanCard` renders for it. */
const PLAN_CTA: Record<string, string> = {
  base: pricingCopy('cta_free'),
  spark: pricingCopy('cta_spark'),
  ace: pricingCopy('cta_ace'),
  pro: pricingCopy('cta_pro'),
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

/** The individual plan catalogue, as the page's own API returns it. */
async function fetchPlans(page: Page): Promise<PlanInfo[]> {
  const response = await page.request.get('/api/v1/subscription-plans?scope=personal');
  expect(response.status(), 'GET /api/v1/subscription-plans?scope=personal').toBe(200);
  const body = await json<ApiEnvelope<PlanInfo[]>>(response);
  expect(body.success, 'the plans response').toBe(true);
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
async function expectPlanGrid(page: Page, plans: PlanInfo[], currentPlan: PlanInfo): Promise<void> {
  expect(
    plans.map((plan) => plan.name),
    'the page renders the individual catalogue',
  ).toEqual([...PLAN_NAMES]);
  for (const plan of plans) {
    expect(plan.scope, `plan ${plan.key} is personal-scope`).toBe('personal');
    expect(plan.audience, `plan ${plan.key} has no audience`).toBeNull();
  }

  await expect(planCards(page)).toHaveCount(PLAN_NAMES.length);
  await expect
    .poll(async () => planCards(page).locator('[data-slot="card-title"]').allInnerTexts(), {
      message: 'plan cards keep the catalogue order',
    })
    .toEqual([...PLAN_NAMES]);

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
  test('a student sees the individual plans and Free is marked as the current plan', async ({
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

    const plans = await fetchPlans(page);
    const currentPlan = await fetchCurrentPlan(page, '/api/v1/me/personal-plan');
    expect(currentPlan.key, 'the seeded student starts on the free Free plan').toBe('base');

    // --- Step 1: /app/upgrade -------------------------------------------------
    await page.goto('/app/upgrade');
    await expectUpgradeShell(page);
    await expectPlanGrid(page, plans, currentPlan);

    // The purchase button starts a checkout for that very plan.
    await planCard(page, 'StudiQ Plus')
      .getByRole('button', { name: PLAN_CTA.spark, exact: true })
      .click();
    await page.waitForURL(/\/checkout\?/, { timeout: 20_000 });
    expect(new URL(page.url()).searchParams.get('plan_id'), 'the checkout targets Plus').toBe(
      'spark',
    );
    await expect(page.getByText('Podsumowanie zamówienia', { exact: true })).toBeVisible();
    await expect(page.getByText('StudiQ Plus', { exact: true }).first()).toBeVisible();

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });

  test('an educator sees the same individual plans and Free is marked as the current plan', async ({
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

    const plans = await fetchPlans(page);
    // Unseated educator: `/me/plan` falls back to the personal plan the trigger wrote.
    const currentPlan = await fetchCurrentPlan(page, '/api/v1/me/plan');
    expect(currentPlan.key, 'the seeded educator starts on the free Free plan').toBe('base');

    // --- Step 2: /edu/upgrade ------------------------------------------------
    await page.goto('/edu/upgrade');
    await expectUpgradeShell(page);
    await expectPlanGrid(page, plans, currentPlan);

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });

  test('each upgrade page loads for either account type and shows the same ladder', async ({
    page,
  }) => {
    const { tenant } = account('student');

    // Area routes are auth-only (ADR-0015 §7.1): a student may open the educator
    // upgrade page and keeps the URL. Persona no longer filters the ladder (#1193).
    await loginAs(page, tenant, 'student', { locale: 'pl' });
    await expect(page).toHaveURL(/\/app$/);
    await page.goto('/edu/upgrade');
    await expect(page).toHaveURL(/\/edu\/upgrade$/);
    await expectUpgradeShell(page);
    await expect(planCards(page), 'the individual catalogue renders for the route').toHaveCount(
      PLAN_NAMES.length,
    );

    // A personal plan is purchasable from either area: the checkout no longer
    // refuses a plan by the caller's persona.
    await planCard(page, 'StudiQ Plus')
      .getByRole('button', { name: PLAN_CTA.spark, exact: true })
      .click();
    await page.waitForURL(/\/checkout\?/, { timeout: 20_000 });
    expect(new URL(page.url()).searchParams.get('plan_id')).toBe('spark');
  });
});
