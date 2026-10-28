import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

/**
 * BIL-01 — the student's billing page `/app/billing`.
 *
 * Prerequisite (reconciled with the tenant seeder): a signed-in **student** whose
 * personal plan is the free **Base** tier. The case was written against the legacy
 * manual seed (`student1@dev.local`, password `pass`); the suite version uses the
 * case's own tenant and never the legacy accounts.
 *
 * Tenant (`content` profile — the default, so `qa/tests/profiles/BIL-01.json` needs
 * no entry), fresh run suffix per independent run:
 *
 *   bun scripts/qa-tenant.ts BIL-01 --fresh
 *
 * gives `qa-bil-01-<suffix>` (`tenantKey('qa/cases/BIL-01.md', 'BIL-01#<suffix>',
 * 'qa-shared')` + `tenantId` for every org/user/group id). The student is seeded as
 * an org `member` without a seat assignment, so `/api/v1/me/plan` resolves their
 * **personal** plan (`profiles.personal_plan_key`, default `base`) — the student leg
 * of #270/#181. Nothing global is written: the plan catalogue is only read.
 *
 * Walk observation (shared app, pl): the sidebar user menu at the bottom of `/app`
 * lists „Wybierz plan / Konto / Płatności / Polski / English / Motyw / Wyloguj się”.
 * „Płatności” opens `/app/billing`, which renders heading „Rozliczenia”, subtitle
 * „Zarządzaj subskrypcją i danymi rozliczeniowymi” and one card „Aktualny plan” with
 * „StudiQ Base”, the „Darmowy” badge, the Base features (Fiszki, Testy), every Base
 * limit (Maks. fiszki 100, Maks. talie 10, Maks. pytania 50, Maks. banki pytań 5,
 * Próby dziennie 10, Tokeny AI / dzień 0 — no `NaN`) and the „Wybierz plan” button,
 * which navigates to `/app/upgrade`. The behavior matches the case exactly.
 *
 * Asserted behaviour (the case's expected result):
 * - the menu entry „Płatności” leads to `/app/billing`;
 * - the page shows „Rozliczenia”, the current plan card with the student's plan
 *   name and the „Darmowy” badge (price 0);
 * - every feature and limit the plan API returns for that plan is rendered with the
 *   API's value — including the zero-token limit — and no row reads `NaN`;
 * - „Wybierz plan” leads to `/app/upgrade`.
 *
 * Adjacent regression that matters for this surface: a student plan must not render
 * the organization-only limit rows (seats/groups, stored as `-1` for Base and
 * therefore indistinguishable from „Bez ograniczeń”).
 */

const CASE = 'BIL-01';

const MENU_BILLING = 'Płatności';
const BILLING_URL = /\/app\/billing$/;
const UPGRADE_URL = /\/app\/upgrade$/;

const BILLING_COPY = {
  title: 'Rozliczenia',
  subtitle: 'Zarządzaj subskrypcją i danymi rozliczeniowymi',
  currentPlan: 'Aktualny plan',
  freeBadge: 'Darmowy',
  upgrade: 'Wybierz plan',
} as const;

const UPGRADE_COPY = {
  title: 'Rozwiń swój plan',
  subtitle: 'Wybierz plan odpowiedni dla Twoich potrzeb',
} as const;

/** Base feature keys → the Polish labels `/app/billing` renders. */
const FEATURE_LABELS: Record<string, string> = {
  flashcards: 'Fiszki',
  quiz: 'Testy',
};

/** Student limit keys → the Polish labels `/app/billing` renders. */
const LIMIT_LABELS: Record<string, string> = {
  max_flashcards: 'Maks. fiszki',
  max_decks: 'Maks. talie',
  max_questions: 'Maks. pytania',
  max_question_banks: 'Maks. banki pytań',
  max_quiz_attempts_per_day: 'Próby dziennie',
  max_ai_tokens_per_day: 'Tokeny AI / dzień',
};

/** Organization-only limits: never shown on a student's own plan. */
const ORG_ONLY_LIMIT_LABELS = ['Maks. studentów', 'Maks. grup'] as const;

/** The Base limits the case's expected result names. */
const BASE_LIMITS: Record<string, number> = {
  max_flashcards: 100,
  max_decks: 10,
  max_questions: 50,
  max_question_banks: 5,
  max_quiz_attempts_per_day: 10,
  max_ai_tokens_per_day: 0,
};

interface PlanInfo {
  key: string;
  name: string;
  priceMonthly: number;
  features: string[];
  limits: Record<string, number>;
}

/** `GET` an endpoint as the signed-in student and unwrap the response envelope. */
async function getPlan(page: Page): Promise<PlanInfo> {
  const response = await page.request.get('/api/v1/me/plan');
  expect(response.status(), 'GET /api/v1/me/plan').toBe(200);
  const body = (await response.json()) as { success: boolean; data: PlanInfo };
  expect(body.success, 'GET /api/v1/me/plan success flag').toBe(true);
  return body.data;
}

/** The user menu sits at the bottom of the dashboard sidebar. */
function userMenuTrigger(page: Page): Locator {
  return page.locator('[data-slot="sidebar-footer"] [data-sidebar="menu-button"]');
}

/** The „Aktualny plan” card, so copy lookups never match the menu or breadcrumb. */
function currentPlanCard(page: Page): Locator {
  return page.locator('[data-slot="card"]').filter({
    has: page.locator('[data-slot="card-title"]', { hasText: BILLING_COPY.currentPlan }),
  });
}

/** One limit row inside the plan card, found by its label. */
function limitRow(card: Locator, label: string): Locator {
  return card
    .locator('div.flex.items-center.justify-between')
    .filter({ has: card.page().getByText(label, { exact: true }) });
}

test.describe('@case:BIL-01 @area:BIL @prio:P2 student billing page', () => {
  test('„Płatności” shows the student Base plan and „Wybierz plan” opens /app/upgrade', async ({
    page,
  }) => {
    const tenant = loadTenant(CASE);
    const student = tenant.users.student;
    if (!student) {
      throw new Error(
        `BIL-01 fixture incomplete: run \`bun scripts/qa-tenant.ts ${CASE} --fresh\``,
      );
    }

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // --- Prerequisite: the tenant's student, signed in, Polish UI --------------
    await loginAs(page, tenant, 'student', { locale: 'pl' });
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

    // The case's entitlement: the student's own free Base plan.
    const plan = await getPlan(page);
    expect(plan.key, 'the seeded student resolves their personal plan').toBe('base');
    expect(plan.priceMonthly, 'Base is the free tier').toBe(0);

    // --- Step 1: „Płatności” from the user menu -------------------------------
    const menuTrigger = userMenuTrigger(page);
    await expect(menuTrigger).toContainText(student.email);
    await menuTrigger.click();
    const billingItem = page.getByRole('menuitem', { name: MENU_BILLING, exact: true });
    await expect(billingItem).toBeVisible();
    await billingItem.click();
    await expect(page.getByRole('menu')).toBeHidden();
    await expect(page).toHaveURL(BILLING_URL, { timeout: 20_000 });

    // --- Title and current plan card ------------------------------------------
    await expect(
      page.getByRole('heading', { level: 1, name: BILLING_COPY.title, exact: true }),
    ).toBeVisible();
    await expect(page.getByText(BILLING_COPY.subtitle, { exact: true })).toBeVisible();

    const card = currentPlanCard(page);
    await expect(card).toHaveCount(1);
    await expect(card.locator('[data-slot="card-title"]')).toHaveText(BILLING_COPY.currentPlan);
    // The page renders the plan the API resolved for this user, not a pinned name.
    await expect(card.locator('[data-slot="card-description"]')).toHaveText(plan.name);
    await expect(card.locator('[data-slot="badge"]')).toHaveText(BILLING_COPY.freeBadge);

    // --- Features: Fiszki, Testy ---------------------------------------------
    expect(plan.features, 'the Base feature set').toEqual(
      expect.arrayContaining(['flashcards', 'quiz']),
    );
    for (const feature of plan.features) {
      const label = FEATURE_LABELS[feature] ?? feature;
      await expect(card.getByText(label, { exact: true })).toBeVisible();
    }

    // --- Limits: the case's numbers, rendered without `NaN` -------------------
    for (const [key, expected] of Object.entries(BASE_LIMITS)) {
      expect(plan.limits[key], `Base limit ${key}`).toBe(expected);
    }
    for (const [key, label] of Object.entries(LIMIT_LABELS)) {
      const value = plan.limits[key];
      expect(value, `the plan carries ${key}`).toBeDefined();
      const row = limitRow(card, label);
      await expect(row, `limit row ${label}`).toHaveCount(1);
      // The row's second span is the value (the label comes first).
      await expect(row.locator('span').last()).toHaveText(value.toLocaleString('pl'));
    }

    // The case explicitly forbids placeholder numbers on this page.
    await expect(card).not.toContainText('NaN');
    expect(await page.locator('body').innerText(), 'the page must not print NaN').not.toContain(
      'NaN',
    );

    // Adjacent: seats/groups are organization limits; a student plan must hide them
    // instead of rendering Base's `-1` as „Bez ograniczeń”.
    for (const label of ORG_ONLY_LIMIT_LABELS) {
      await expect(card.getByText(label, { exact: true }), `${label} must stay hidden`).toHaveCount(
        0,
      );
    }

    // --- „Wybierz plan” leads to /app/upgrade --------------------------------
    await card.getByRole('button', { name: BILLING_COPY.upgrade, exact: true }).click();
    await expect(page).toHaveURL(UPGRADE_URL, { timeout: 20_000 });
    await expect(
      page.getByRole('heading', { level: 1, name: UPGRADE_COPY.title, exact: true }),
    ).toBeVisible();
    await expect(page.getByText(UPGRADE_COPY.subtitle, { exact: true })).toBeVisible();

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });
});
