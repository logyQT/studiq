import { expect, test, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaRole } from '@qa/fixtures/qa-tenant';

/**
 * STU-53 — the user menu has no „Powiadomienia” entry (notifications are not built).
 *
 * The manual case (v1.3, 17.10.2026) was written against a menu that still showed
 * „Powiadomienia”: the expectation was that the item exists and that clicking it only
 * closes the menu, because no notifications screen exists yet. The product decision
 * from 2026-10-25 (issue #280, closed as completed; fix #596 „hide dead Powiadomienia
 * entry from the user menu”) reversed that: a dead entry is a defect, so the item is
 * hidden from every role until a notifications surface exists. The intended behaviour
 * today is therefore the acceptance criterion of #280 — **no „Powiadomienia” entry for
 * any role, and no other menu item changes** — and that is what this spec asserts.
 * The menu definition in `user-menu-content.tsx` keeps the future notification shapes
 * in a TODO next to the list; nothing here pins that comment, only the rendered menu.
 *
 * Tenant (deterministic, `content` profile, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts STU-53 --fresh
 *
 * gives the organization `qa-stu-53-<suffix>` with a manager, an educator and the
 * student this case signs in as — all ids derived from
 * `tenantKey('qa/cases/STU-53.md', 'STU-53#<suffix>', 'qa-shared')` + `tenantId(key,
 * entity)`. The case's prerequisite („Zalogowany student1”, the legacy
 * `student1@dev.local` with `pass`) maps onto that student. The menu is pure
 * navigation: nothing is written, so a retry or a `--repeat-each` pass on the same
 * CI-seeded tenant starts from the same state.
 *
 * Walk on the shared app (:3010, Polish UI, worker qa-env-7, 2026-10-29) confirmed the
 * menu for the student, the teacher and the manager:
 * - The user menu is the sidebar-footer button. It opens „Wybierz plan”,
 *   „Konto”, „Płatności”, „Wyloguj się”, plus the „Język” row with its select
 *   (#634) and the „Motyw” three-position switch (#635).
 * - There is no „Powiadomienia” / „Notifications” entry for any of the three roles,
 *   and no notifications screen: `/app/notifications` answers 404.
 * - „Konto” still opens `/app/account` and the menu closes; Escape closes the menu
 *   without navigating. No uncaught page error during the walk.
 */

const CASE = 'STU-53';

/** The user-menu entries the product ships today (`pl` copy). */
const MENU = {
  upgrade: 'Wybierz plan',
  account: 'Konto',
  billing: 'Płatności',
  logout: 'Wyloguj się',
} as const;

/** The setting rows (#634 language select, #635 theme switch) — not menu items. */
const SETTINGS = { language: 'Język: Polski', theme: 'Motyw' } as const;

/** The dead entry hidden by #280 — either locale's label must stay absent. */
const NOTIFICATIONS_ITEM = /^(powiadomienia|notifications)$/i;

/** Same regex, for the menu as a whole (a stray label must not slip in). */
const NOTIFICATIONS_TEXT = /powiadomienia|notifications/i;

/** The user menu sits at the bottom of the dashboard sidebar on every dashboard. */
function userMenuTrigger(page: Page) {
  return page.locator('[data-slot="sidebar-footer"] [data-sidebar="menu-button"]');
}

async function openUserMenu(page: Page): Promise<void> {
  await userMenuTrigger(page).click();
  await expect(page.getByRole('menu')).toBeVisible();
}

/** #280's acceptance: a dead „Powiadomienia” entry never reaches the menu again. */
async function expectNoNotificationsEntry(page: Page): Promise<void> {
  await expect(
    page.getByRole('menuitem', { name: NOTIFICATIONS_ITEM }),
    'the dead „Powiadomienia” menu entry is hidden (product decision #280)',
  ).toHaveCount(0);
  await expect(
    page.getByRole('menu'),
    'no menu row mentions notifications in either locale',
  ).not.toContainText(NOTIFICATIONS_TEXT);
}

/** Every shipped entry is still there — hiding notifications changed nothing else. */
async function expectShippedEntries(page: Page): Promise<void> {
  for (const label of Object.values(MENU)) {
    await expect(
      page.getByRole('menuitem', { name: label, exact: true }),
      `the „${label}” entry is in the user menu`,
    ).toBeVisible();
  }
  const menu = page.getByRole('menu');
  await expect(
    menu.getByRole('combobox', { name: SETTINGS.language }),
    'the language row with its select is in the user menu',
  ).toBeVisible();
  await expect(
    menu.getByRole('radiogroup', { name: SETTINGS.theme }),
    'the theme switch is in the user menu',
  ).toBeVisible();
}

test.describe('@case:STU-53 @area:STU @prio:P3 user menu without notifications', () => {
  test('the student user menu has no „Powiadomienia” entry and still works', async ({ page }) => {
    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} runs on the content tenant profile`).toBe('content');
    expect(
      tenant.runSuffix,
      'seed with --fresh: every independent run owns a new tenant',
    ).toBeTruthy();
    expect(tenant.users.student, `${CASE} seeds the student under test`).toBeTruthy();

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // Prerequisite: the tenant student on their own dashboard.
    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app$/ });
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

    // Step 1: open the user menu — the item the case asks for must not be there.
    await openUserMenu(page);
    await expectNoNotificationsEntry(page);
    await expectShippedEntries(page);

    // The case's „click only closes the menu”: with no notifications entry, closing
    // the menu is the only, harmless outcome and the dashboard stays put.
    const dashboardUrl = page.url();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();
    await expect(page).toHaveURL(dashboardUrl);

    // Adjacent regression: hiding the entry left the rest of the menu functional.
    await openUserMenu(page);
    await page.getByRole('menuitem', { name: MENU.account, exact: true }).click();
    await expect(page.getByRole('menu')).toBeHidden();
    await expect(page).toHaveURL(/\/app\/account$/);
    await expect(
      page.getByRole('heading', { level: 1, name: MENU.account, exact: true }),
    ).toBeVisible();

    expect(pageErrors, 'opening the user menu raises no uncaught errors').toEqual([]);
  });

  // #280 applies to the shared menu component, not to the student alone: the dead
  // entry must not come back for any account type.
  for (const role of ['teacher', 'manager'] as const) {
    const prefix = role === 'teacher' ? '/edu' : '/manage';

    test(`the ${role} user menu has no „Powiadomienia” entry`, async ({ page }) => {
      const tenant = loadTenant(CASE);
      expect(tenant.users[role as QaRole], `${CASE} seeds the ${role} account`).toBeTruthy();

      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));

      await loginAs(page, tenant, role as QaRole, {
        locale: 'pl',
        waitFor: new RegExp(`${prefix}$`),
      });
      await expect(page).toHaveURL(new RegExp(`${prefix}$`));

      await openUserMenu(page);
      await expectNoNotificationsEntry(page);
      await expectShippedEntries(page);

      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toBeHidden();

      expect(pageErrors, `opening the ${role} user menu raises no uncaught errors`).toEqual([]);
    });
  }
});
