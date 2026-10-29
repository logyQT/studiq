import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaRole } from '@qa/fixtures/qa-tenant';

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
 * („Przejdź na Spark”, „Wybierz Ace”, „Wybierz Pro” / „Przejdź na Guide”,
 * „Wybierz Creator”, „Wybierz Master”). „Przejdź na Spark” opens
 * `/checkout?session_id=…&plan_id=spark`. A student opening `/edu/upgrade` is
 * redirected to `/app`, an educator opening `/app/upgrade` to `/edu`. The behavior
 * matches the case exactly; no defect to report.
 *
 * Asserted behaviour (the case's expected result):
 * - the student page lists the student plans, the educator page the educator plans,
 *   each in the catalogue's order and with the catalogue's names;
 * - the current plan (Base / Lite) is marked with exactly one „Obecny Plan” badge;
 * - every other plan exposes its purchase/selection button, enabled;
 * - each page shows only its own account type's plans;
 * - the purchase button really starts a checkout for that plan.
 *
 * Adjacent regression that matters for this surface: the two plan pages are gated by
 * account type, so neither dashboard can render the other one's plans.
 *
 * Read-only shared data: the plan catalogue (`subscription_plans`, `plan_limits`) is
 * global; the spec reads it through the API and asserts the page renders it. Nothing
 * global is written — the only write is the checkout session the purchase button
 * creates for this tenant's own student.
 */

const CASE = 'BIL-02';

const UPGRADE_COPY = {
  title: 'Rozwiń swój plan',
  subtitle: 'Wybierz plan odpowiedni dla Twoich potrzeb',
} as const;

const CURRENT_BADGE = 'Obecny Plan';

/** The student plans the case names, in catalogue order. */
const STUDENT_PLAN_NAMES = ['StudiQ Base', 'StudiQ Spark', 'StudiQ Ace', 'StudiQ Pro'] as const;
/** The educator plans the case names, in catalogue order. */
const EDUCATOR_PLAN_NAMES = [
  'StudiQ Lite',
  'StudiQ Guide',
  'StudiQ Creator',
  'StudiQ Master',
] as const;

/** Plan key → the Polish purchase/selection label `PlanCard` renders for it. */
const PLAN_CTA: Record<string, string> = {
  base: 'Zacznij za Darmo',
  spark: 'Przejdź na Spark',
  ace: 'Wybierz Ace',
  pro: 'Wybierz Pro',
  lite: 'Zacznij za Darmo',
  guide: 'Przejdź na Guide',
  creator: 'Wybierz Creator',
  master: 'Wybierz Master',
};

interface PlanInfo {
  key: string;
  name: string;
  priceMonthly: number;
  forAccountType: string | null;
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

/** The plan catalogue for one account type, as the page's own API returns it. */
async function fetchPlans(page: Page, accountType: 'student' | 'educator'): Promise<PlanInfo[]> {
  const response = await page.request.get(`/api/v1/subscription-plans?for=${accountType}`);
  expect(response.status(), `GET /api/v1/subscription-plans?for=${accountType}`).toBe(200);
  const body = (await response.json()) as ApiEnvelope<PlanInfo[]>;
  expect(body.success, `plans response for ${accountType}`).toBe(true);
  return body.data;
}

/** The plan the caller is on (`/me/personal-plan` for students, `/me/plan` otherwise). */
async function fetchCurrentPlan(
  page: Page,
  endpoint: '/api/v1/me/personal-plan' | '/api/v1/me/plan',
): Promise<PlanInfo> {
  const response = await page.request.get(endpoint);
  expect(response.status(), `GET ${endpoint}`).toBe(200);
  const body = (await response.json()) as ApiEnvelope<PlanInfo>;
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
      expect(plan.forAccountType, `plan ${plan.key} belongs to students`).toBe('student');
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
      expect(plan.forAccountType, `plan ${plan.key} belongs to educators`).toBe('educator');
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

  test('each plan page is gated to its own account type', async ({ page, browser, baseURL }) => {
    const { tenant } = account('student');

    // A student cannot open the educator plan page: the proxy sends them home.
    await loginAs(page, tenant, 'student', { locale: 'pl' });
    await expect(page).toHaveURL(/\/app$/);
    await page.goto('/edu/upgrade');
    await page.waitForURL(/\/app$/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { level: 1, name: UPGRADE_COPY.title })).toHaveCount(0);

    // An educator cannot open the student plan page either.
    const context = await browser.newContext({ baseURL: baseURL ?? 'http://localhost:3010' });
    try {
      const educatorPage = await context.newPage();
      await loginAs(educatorPage, tenant, 'teacher', { locale: 'pl' });
      await expect(educatorPage).toHaveURL(/\/edu$/);
      await educatorPage.goto('/app/upgrade');
      await educatorPage.waitForURL(/\/edu$/, { timeout: 20_000 });
      await expect(
        educatorPage.getByRole('heading', { level: 1, name: UPGRADE_COPY.title }),
      ).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
