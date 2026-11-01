import { expect, test, type Page } from '@playwright/test';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

/**
 * MGR-ACC-01 — the manager's user menu: Konto, Płatności, Wybierz plan.
 *
 * Prerequisite (reconciled with the tenant fixture): the `content` tenant — one
 * organization whose manager is its `admin` — replaces the legacy manual seed
 * ("M1"). Nobody else touches that org, so the plan, the account details and the
 * membership role the pages show belong to this run only.
 *
 *   bun scripts/qa-tenant.ts MGR-ACC-01 --fresh
 *
 * The case was written against a build that only had `/manage/billing`: „Konto”
 * and „Wybierz plan” landed on „Nie znaleziono strony”. Both pages exist today
 * (fix #453), so the spec asserts the **intended** behaviour — every entry of the
 * menu opens its own screen — and keeps the 404 as a negative assertion, which is
 * exactly the defect the case asks to confirm.
 *
 * The plan catalogue is global (admins edit it from the admin panel), so nothing
 * here hard-codes a plan name: the upgrade grid and the billing badge are compared
 * with what `/api/v1/subscription-plans` and `/api/v1/me/plan` return in the same
 * run. Everything else is tenant data (`tenantKey`/`tenantId`).
 */

const CASE = 'MGR-ACC-01';

/** The three entries the case clicks, in the case's order. */
const MENU = {
  upgrade: 'Wybierz plan',
  account: 'Konto',
  billing: 'Płatności',
} as const;

/** The heading of the page a 404 would render (ManageNotFound). */
const NOT_FOUND_TITLE = 'Nie znaleziono strony';

/** Copy of the three destination pages (`pl`). */
const PAGES = {
  upgrade: { url: '/manage/upgrade', heading: 'Rozwiń swój plan' },
  account: { url: '/manage/account', heading: 'Konto' },
  billing: { url: '/manage/billing', heading: 'Rozliczenia' },
} as const;

interface PlanInfo {
  key: string;
  name: string;
}

interface MeUser {
  email: string;
  user_metadata: { name?: string };
}

/** `GET` an endpoint as the signed-in user and unwrap the envelope. */
async function getData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.status(), `GET ${url}`).toBe(200);
  const body = (await response.json()) as { success: boolean; data: T };
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data;
}

/** The user menu sits at the bottom of the dashboard sidebar. */
function userMenuTrigger(page: Page) {
  return page.locator('[data-slot="sidebar-footer"] [data-sidebar="menu-button"]');
}

async function openUserMenu(page: Page): Promise<void> {
  await userMenuTrigger(page).click();
  await expect(page.getByRole('menu')).toBeVisible();
}

async function chooseFromUserMenu(page: Page, label: string): Promise<void> {
  await openUserMenu(page);
  await page.getByRole('menuitem', { name: label, exact: true }).click();
  await expect(page.getByRole('menu')).toBeHidden();
}

/** The 404 the case reports: it must not be what any of these entries lands on. */
async function expectNoNotFoundPage(page: Page): Promise<void> {
  await expect(page.locator('body')).not.toContainText(NOT_FOUND_TITLE);
}

test.describe('MGR-ACC-01 — manager user menu', () => {
  test('„Wybierz plan”, „Konto” and „Płatności” each open their own page', async ({ page }) => {
    const tenant = loadTenant(CASE);
    const manager = tenant.users.manager;
    if (!manager) throw new Error(`tenant ${CASE} has no seeded manager`);
    if (!tenant.org) throw new Error(`tenant ${CASE} has no organization`);

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // Manager of this org, Polish UI like the case.
    await loginAs(page, tenant, 'manager', { locale: 'pl' });
    await expect(page).toHaveURL(/\/manage$/);
    await expect(page.locator('[data-slot="sidebar-header"]')).toContainText(tenant.org.name);

    // 1. Open the user menu at the bottom of the sidebar: the three entries exist.
    await openUserMenu(page);
    for (const label of Object.values(MENU)) {
      await expect(page.getByRole('menuitem', { name: label, exact: true })).toBeVisible();
    }
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();

    // 2. „Wybierz plan” → /manage/upgrade: the organization plan catalogue.
    await chooseFromUserMenu(page, MENU.upgrade);
    await expect(page).toHaveURL(new RegExp(`${PAGES.upgrade.url}$`));
    await expect(
      page.getByRole('heading', { level: 1, name: PAGES.upgrade.heading, exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Wybierz plan odpowiedni dla Twoich potrzeb')).toBeVisible();
    await expectNoNotFoundPage(page);

    const managerPlans = await getData<PlanInfo[]>(page, '/api/v1/subscription-plans?for=manager');
    expect(managerPlans.length, 'the manager plan catalogue is empty').toBeGreaterThan(0);
    // One card per catalogued plan, in catalogue order — the page renders the API.
    await expect(page.locator('[data-slot="card"] [data-slot="card-title"]')).toHaveText(
      managerPlans.map((plan) => plan.name),
    );

    // 3. „Konto” → /manage/account: the manager's own account screen (name, e-mail,
    //    role and the password form), not a 404.
    await chooseFromUserMenu(page, MENU.account);
    await expect(page).toHaveURL(new RegExp(`${PAGES.account.url}$`));
    await expect(
      page.getByRole('heading', { level: 1, name: PAGES.account.heading, exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Zarządzaj ustawieniami konta', { exact: true })).toBeVisible();
    await expectNoNotFoundPage(page);

    const me = await getData<{ user: MeUser }>(page, '/api/v1/auth/me');
    await expect(page.locator('#name')).toHaveValue(me.user.user_metadata.name ?? '');
    await expect(page.locator('input[readonly]')).toHaveValue(manager.email);
    // The org role the manager holds, not the account type.
    await expect(page.locator('[data-slot="badge"]')).toHaveText('admin');

    // The screen the case says is missing: a working password form.
    await expect(page.getByText('Zmień hasło', { exact: true })).toBeVisible();
    await expect(page.locator('#currentPassword')).toBeVisible();
    await expect(page.locator('#newPassword')).toBeVisible();
    await expect(page.locator('#confirmPassword')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zaktualizuj hasło' })).toBeDisabled();

    // 4. „Płatności” → /manage/billing: the billing page with the current plan.
    await chooseFromUserMenu(page, MENU.billing);
    await expect(page).toHaveURL(new RegExp(`${PAGES.billing.url}$`));
    await expect(
      page.getByRole('heading', { level: 1, name: PAGES.billing.heading, exact: true }),
    ).toBeVisible();
    await expectNoNotFoundPage(page);

    await expect(page.getByText('Aktualny plan', { exact: true })).toBeVisible();
    await expect(page.getByText('Plan uczelniany', { exact: true })).toBeVisible();

    // The badge names this organization's plan: `/me/plan` resolves the active org
    // plan first, and the page renders the same row from the catalogue.
    const activePlan = await getData<PlanInfo>(page, '/api/v1/me/plan');
    const catalogue = await getData<PlanInfo[]>(page, '/api/v1/subscription-plans');
    const expectedPlanName =
      catalogue.find((plan) => plan.key === activePlan.key)?.name ?? activePlan.name;
    await expect(page.locator('[data-slot="badge"]')).toHaveText(expectedPlanName);

    // The only action the simulated billing module offers.
    await expect(page.getByRole('link', { name: 'Kontakt z handlowcem' })).toHaveAttribute(
      'href',
      'mailto:sales@studiq.app',
    );

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });

  // Adjacent regression the case compares against: the menu is one shared component,
  // so each account type must keep landing on its own dashboard prefix. The account
  // screen is the same `AccountPageContent` for all three types — the per-type
  // upgrade/billing screens have their own surface and their own cases.
  for (const role of ['teacher', 'student'] as const) {
    const prefix = role === 'teacher' ? '/edu' : '/app';

    test(`the ${role} user menu keeps opening ${prefix}/account`, async ({ page }) => {
      const tenant = loadTenant(CASE);

      await loginAs(page, tenant, role, { locale: 'pl' });
      await expect(page).toHaveURL(new RegExp(`${prefix}$`));

      await openUserMenu(page);
      await expect(page.getByRole('menuitem', { name: MENU.account, exact: true })).toBeVisible();
      await page.getByRole('menuitem', { name: MENU.account, exact: true }).click();
      await expect(page.getByRole('menu')).toBeHidden();
      await expect(page).toHaveURL(new RegExp(`${prefix}/account$`));
      await expect(
        page.getByRole('heading', { level: 1, name: PAGES.account.heading, exact: true }),
      ).toBeVisible();
      await expect(page.locator('#name')).not.toBeEmpty();
      await expectNoNotFoundPage(page);
    });
  }
});
