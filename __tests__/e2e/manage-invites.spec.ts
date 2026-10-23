import { expect, test } from '@playwright/test';
import { t } from '#test/e2e/utils';

const PASSWORD = 'pass';
const BULK_INVITES_URL = '/api/v1/organization/invites/bulk';

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel(t('LoginPage.email_label')).fill('manager@dev.local');
  await page.getByLabel(t('LoginPage.password_label')).fill(PASSWORD);
  await page.getByRole('button', { name: t('LoginPage.login_button') }).click();
  await page.waitForURL(/\/manage/);
}

async function openInvitesPage(page: import('@playwright/test').Page) {
  await Promise.all([
    page.waitForResponse((res) => res.url().includes('/api/v1/organization/roles')),
    page.goto('/manage/invites'),
  ]);
  await page.waitForLoadState('networkidle');
}

async function getMemberRoleId(page: import('@playwright/test').Page) {
  const body = await page.evaluate(async () => {
    const res = await fetch('/api/v1/organization/roles');
    return res.json();
  });
  const member = (body.data as { id: string; name: string }[]).find((r) => r.name === 'member');
  expect(member).toBeDefined();
  return member!.id;
}

test.describe('Manage invitations — role defaults (#241)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await openInvitesPage(page);
  });

  test('a newly added row starts without a role and cannot be sent as-is', async ({ page }) => {
    const roleLabel = t('ManageInvitationsPage.role_label');

    // The freshly loaded row is already correct.
    await expect(page.locator('#role-0')).toHaveText(roleLabel);

    let bulkRequests = 0;
    page.on('request', (req) => {
      if (req.url().includes(BULK_INVITES_URL)) bulkRequests += 1;
    });

    await page.getByRole('button', { name: t('ManageInvitationsPage.add_member') }).click();

    // Regression: the added row used to be pre-filled with the first role (admin).
    await expect(page.locator('#role-1')).toHaveText(roleLabel);

    await page.locator('#email-1').fill('qa-admin-default@example.com');
    await page.getByRole('button', { name: t('ManageInvitationsPage.send_invitations') }).click();

    await expect(page.getByText(t('ManageInvitationsPage.no_invites'))).toBeVisible();
    expect(bulkRequests).toBe(0);
  });

  test('the form reset after a successful send starts without a role', async ({ page }) => {
    const roleLabel = t('ManageInvitationsPage.role_label');
    const memberRoleId = await getMemberRoleId(page);

    const postedBodies: { invitations: { email: string; targetOrgRoleId: string }[] }[] = [];
    await page.route(`**${BULK_INVITES_URL}`, async (route) => {
      postedBodies.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          statusCode: 200,
          data: { results: [{ success: true }] },
        }),
      });
    });

    await page.locator('#email-0').fill('qa-role-reset@example.com');
    await page.locator('#role-0').click();
    await page.getByRole('option', { name: 'member', exact: true }).click();

    await page.getByRole('button', { name: t('ManageInvitationsPage.send_invitations') }).click();

    await expect(page.getByText(t('ManageInvitationsPage.success'))).toBeVisible();

    expect(postedBodies).toHaveLength(1);
    expect(postedBodies[0].invitations).toEqual([
      { email: 'qa-role-reset@example.com', targetOrgRoleId: memberRoleId },
    ]);

    // Regression: the reset row used to be re-seeded with the first role (admin).
    await expect(page.locator('#email-0')).toHaveValue('');
    await expect(page.locator('#role-0')).toHaveText(roleLabel);
  });
});
