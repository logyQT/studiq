import { expect, type Page, test } from '@playwright/test';
import { t } from '#test/e2e/utils';

const PASSWORD = 'pass';
const MANAGER_EMAIL = 'manager@dev.local';

async function loginAndOpenRoles(page: Page) {
  await page.goto('/login');
  await page.getByLabel(t('LoginPage.email_label')).fill(MANAGER_EMAIL);
  await page.getByLabel(t('LoginPage.password_label')).fill(PASSWORD);
  await page.getByRole('button', { name: t('LoginPage.login_button') }).click();

  // A fresh session has no active-org cookie yet, so useOrgs() auto-selects the
  // first membership and pushes /manage. Wait for the switcher to render the org
  // so no later redirect interrupts the roles page.
  await page.waitForURL(/\/manage\/?$/, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: /WSB Merito/ })).toBeVisible({ timeout: 30_000 });

  await page.goto('/manage/roles');
  await page.waitForURL(/\/manage\/roles$/, { timeout: 30_000 });
  await expect(
    page.getByRole('heading', { level: 1, name: t('ManageRolesPage.title') }),
  ).toBeVisible({ timeout: 30_000 });
  // The list is ungated on every plan, so a seeded system role must always render.
  await expect(page.locator('tbody tr').filter({ hasText: 'admin' }).first()).toBeVisible({
    timeout: 30_000,
  });
}

/** Live entitlement, so the spec documents both states without hardcoding a seed. */
async function roleBuilderEntitled(page: Page): Promise<boolean> {
  const res = await page.request.get('/api/v1/features/me');
  expect(res.status()).toBe(200);
  const { features } = (await res.json()).data as { features: string[] };
  return features.includes('role.builder');
}

/**
 * #259 — the write endpoints require the `role.builder` plan feature, but the page
 * used to render an enabled create/edit/delete/permission UI on Launch and then
 * collapse the 403 into a generic toast. The list stays readable; only writes are
 * replaced by the same locked card the settings and AI pages use.
 */
test.describe('Manage roles — role.builder plan gate (#259)', () => {
  test('Launch org shows the locked card and a read-only role list', async ({ page }) => {
    await loginAndOpenRoles(page);
    test.skip(await roleBuilderEntitled(page), 'org is entitled to role.builder');

    await expect(page.getByText(t('ManageRolesPage.locked_title'))).toBeVisible();
    await expect(page.getByText(t('ManageRolesPage.locked_desc'))).toBeVisible();

    // No enabled write affordances, and no dead "Actions" column.
    await expect(page.getByRole('button', { name: t('ManageRolesPage.new_role') })).toHaveCount(0);
    await expect(page.getByText(t('ManageRolesPage.col_actions'))).toHaveCount(0);
    await expect(page.locator('tbody button')).toHaveCount(0);

    // The list itself is still reachable, like /manage/settings on a locked plan.
    await expect(page.locator('tbody tr').first()).toBeVisible();

    await page.getByRole('button', { name: t('ManageRolesPage.locked_cta') }).click();
    await page.waitForURL(/\/pricing\/org$/);
  });

  test('entitled org keeps the create flow and never renders the locked card', async ({ page }) => {
    await loginAndOpenRoles(page);
    test.skip(!(await roleBuilderEntitled(page)), 'org plan lacks role.builder');

    await expect(page.getByText(t('ManageRolesPage.locked_title'))).toHaveCount(0);

    const newRole = page.getByRole('button', { name: t('ManageRolesPage.new_role') });
    await expect(newRole).toBeVisible();
    await newRole.click();
    await expect(page.getByText(t('ManageRolesPage.create_title'))).toBeVisible();
  });
});
