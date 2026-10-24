import { expect, test } from '@playwright/test';
import { t } from '#test/e2e/utils';

const PASSWORD = 'pass';

/**
 * The manager dashboard's own account / plan pages (#178). `/manage/account` and
 * `/manage/upgrade` did not exist, so the footer user menu 404'd, and the
 * overview's "invite members" quick action pointed at `/manage/invitations`
 * (the real page is `/manage/invites`).
 */
async function loginAsManager(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel(t('LoginPage.email_label')).fill('manager@dev.local');
  await page.getByLabel(t('LoginPage.password_label')).fill(PASSWORD);
  await page.getByRole('button', { name: t('LoginPage.login_button') }).click();

  // A fresh session has no active-org cookie yet, so useOrgs() auto-selects the
  // first membership and pushes /manage. Wait for that arrival *and* for the
  // switcher to render the active org — that push races any navigation we make
  // before the org switch resolves (see manage-invites.spec.ts).
  await page.waitForURL(/\/manage\/?$/, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: /WSB Merito/ })).toBeVisible({ timeout: 30_000 });
}

/**
 * The sidebar user menu keeps its dropdown open after an item is clicked (the
 * items are plain buttons, unlike the Radix `DropdownMenuItem`s), and an open
 * Radix menu marks the rest of the page `aria-hidden` — so it has to be closed
 * before role-based assertions on the target page.
 */
async function openUserMenuAndPick(
  page: import('@playwright/test').Page,
  item: RegExp,
): Promise<void> {
  await page.getByRole('button', { name: /manager@dev\.local/ }).click();
  await page.getByRole('button', { name: item }).click();
  await page.keyboard.press('Escape');
}

test.describe('Manager account and plan pages (#178)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsManager(page);
  });

  test('the invite quick action opens /manage/invites', async ({ page }) => {
    const invite = page.getByRole('link', { name: t('ManageOverviewPage.invite_members') });

    // The link itself must point at the real invites page, not the dead
    // /manage/invitations path.
    await expect(invite).toHaveAttribute('href', '/manage/invites');

    await invite.click();

    await page.waitForURL(/\/manage\/invites$/, { timeout: 30_000 });
    await expect(page.locator('#email-0')).toBeVisible();
  });

  test('Konto opens the manager account page', async ({ page }) => {
    await openUserMenuAndPick(page, t('DashboardLayout.account'));

    await page.waitForURL(/\/manage\/account$/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: t('AccountPage.title') })).toBeVisible();
    await expect(page.getByText(t('AccountPage.password_section'))).toBeVisible();
  });

  test('Wybierz plan opens the manager plan page', async ({ page }) => {
    await openUserMenuAndPick(page, t('DashboardLayout.upgrade'));

    await page.waitForURL(/\/manage\/upgrade$/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: t('UpgradePage.title') })).toBeVisible();

    // The manager plan grid loaded. Assert on the cheapest paid CTA (a seeded
    // manager plan) rather than plan names/order. Never click it: checkout
    // applies the org plan.
    await expect(page.getByRole('button', { name: t('PricingPage.cta_team') })).toBeVisible();
  });
});
