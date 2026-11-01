import { expect, test, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaRole } from '@qa/fixtures/qa-tenant';

/**
 * STU-53 — the user menu „Powiadomienia” entry opens the notification bell.
 *
 * The manual case (v1.3, 17.10.2026) expected a „Powiadomienia” entry that only
 * closed the menu, because no notifications screen existed. The product decision
 * from 2026-10-25 (issue #280) then hid the dead entry until a surface existed.
 * #664 builds that surface: the dashboard header now has a bell with an unread
 * badge and a popover, and the shared user menu offers „Powiadomienia” again. The
 * acceptance criterion is therefore the case's original one, with a real
 * destination: **the entry exists for every dashboard role, and selecting it
 * closes the menu and opens the bell popover without navigating.**
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
 * navigation and opening the bell only reads, so a retry or a `--repeat-each` pass
 * on the same CI-seeded tenant starts from the same state.
 *
 * The entry is only rendered on dashboard menus (`notifications` prop), because
 * the public pages have no bell: the teacher and manager cases pin that the shared
 * component shows it on `/edu` and `/manage` too. The mobile drawer keeps the menu
 * without it — the bell sits in the header there, so the row is not needed and the
 * plain variant does not pass the prop.
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

/** The entry restored by #664 — either locale's label. */
const NOTIFICATIONS_ITEM = /^(powiadomienia|notifications)$/i;

/** The bell popover (Radix PopoverContent, role="dialog" with its title as the name). */
/** Polish copy from `Notifications.title` (`apps/web/src/i18n/messages/pl.json`). */
const NOTIFICATIONS_DIALOG = 'Powiadomienia';

/** The user menu sits at the bottom of the dashboard sidebar on every dashboard. */
function userMenuTrigger(page: Page) {
  return page.locator('[data-slot="sidebar-footer"] [data-sidebar="menu-button"]');
}

async function openUserMenu(page: Page): Promise<void> {
  await userMenuTrigger(page).click();
  await expect(page.getByRole('menu')).toBeVisible();
}

/** The notifications entry is offered where the bell is mounted. */
async function expectNotificationsEntry(page: Page): Promise<void> {
  await expect(
    page.getByRole('menuitem', { name: NOTIFICATIONS_ITEM }),
    'the „Powiadomienia” menu entry exists on the dashboard',
  ).toHaveCount(1);
}

/** Every other shipped entry is still there — the new row changed nothing else. */
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

test.describe('@case:STU-53 @area:STU @prio:P3 user menu notifications entry', () => {
  test('the student user menu opens the notification bell', async ({ page }) => {
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

    // Step 1: open the user menu — the entry the case asks for is there again.
    await openUserMenu(page);
    await expectNotificationsEntry(page);
    await expectShippedEntries(page);

    // Step 2: select it. The menu closes and the bell popover opens in place; the
    // dashboard URL does not change, so nothing navigates away.
    const dashboardUrl = page.url();
    await page.getByRole('menuitem', { name: NOTIFICATIONS_ITEM }).click();
    await expect(page.getByRole('menu')).toBeHidden();
    await expect(
      page.getByRole('dialog', { name: NOTIFICATIONS_DIALOG }),
      'the bell popover is the entry’s destination',
    ).toBeVisible();
    await expect(page).toHaveURL(dashboardUrl);

    // Escape closes the popover and still leaves the dashboard where it was.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: NOTIFICATIONS_DIALOG })).toBeHidden();
    await expect(page).toHaveURL(dashboardUrl);

    // Adjacent regression: the rest of the menu is still functional.
    await openUserMenu(page);
    await page.getByRole('menuitem', { name: MENU.account, exact: true }).click();
    await expect(page.getByRole('menu')).toBeHidden();
    await expect(page).toHaveURL(/\/app\/account$/);
    await expect(
      page.getByRole('heading', { level: 1, name: MENU.account, exact: true }),
    ).toBeVisible();

    expect(pageErrors, 'opening the user menu raises no uncaught errors').toEqual([]);
  });

  // The entry lives in the shared menu component, so every dashboard role gets it
  // where the bell is mounted; the public pages render the menu without it.
  for (const role of ['teacher', 'manager'] as const) {
    const prefix = role === 'teacher' ? '/edu' : '/manage';

    test(`the ${role} user menu offers the notifications entry`, async ({ page }) => {
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
      await expectNotificationsEntry(page);
      await expectShippedEntries(page);

      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toBeHidden();

      expect(pageErrors, `opening the ${role} user menu raises no uncaught errors`).toEqual([]);
    });
  }
});
