import { expect, type Page, test } from '@playwright/test';
import { t } from '#test/e2e/utils';

const PASSWORD = 'pass';
const MEMBERS_URL = '/api/v1/organization/members';
const MEMBER_EMAIL = 'student1@dev.local';

async function loginAndOpenMembers(page: Page) {
  // Register before navigation so the members page's own fetches can't be missed.
  const membersLoaded = page.waitForResponse(
    (res) => res.url().includes(MEMBERS_URL) && res.request().method() === 'GET' && res.ok(),
    { timeout: 30_000 },
  );
  const rolesLoaded = page.waitForResponse(
    (res) => res.url().includes('/api/v1/organization/roles') && res.ok(),
    { timeout: 30_000 },
  );

  await page.goto('/login');
  await page.getByLabel(t('LoginPage.email_label')).fill('manager@dev.local');
  await page.getByLabel(t('LoginPage.password_label')).fill(PASSWORD);
  await page.getByRole('button', { name: t('LoginPage.login_button') }).click();

  // A fresh session has no active-org cookie yet, so useOrgs() auto-selects the
  // first membership and pushes /manage. Wait for that arrival *and* for the
  // switcher to render the active org, so no later redirect interrupts us.
  await page.waitForURL(/\/manage\/?$/, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: /WSB Merito/ })).toBeVisible({ timeout: 30_000 });

  await page.goto('/manage/members');
  await page.waitForURL(/\/manage\/members$/, { timeout: 30_000 });

  await Promise.all([membersLoaded, rolesLoaded]);
  await expect(memberRow(page)).toBeVisible();
}

function memberRow(page: Page) {
  return page.getByRole('row', { name: new RegExp(MEMBER_EMAIL.replace('.', '\\.')) });
}

function roleTrigger(page: Page) {
  return memberRow(page).getByRole('combobox');
}

async function getRoleId(page: Page, name: string) {
  const body = await page.evaluate(async () => {
    const res = await fetch('/api/v1/organization/roles');
    return res.json();
  });
  const role = (body.data as { id: string; name: string }[]).find((r) => r.name === name);
  expect(role, `role "${name}" missing from /api/v1/organization/roles`).toBeDefined();
  return role!.id;
}

async function pickRole(page: Page, displayName: string) {
  await roleTrigger(page).click();
  await page.getByRole('option', { name: displayName, exact: true }).click();
}

test.describe('Manage members — role change confirmation (#246)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndOpenMembers(page);
  });

  test('cancelling keeps the dropdown on the real role and re-picking reopens the dialog', async ({
    page,
  }) => {
    const putRequests: { method: string; body: string | null }[] = [];
    page.on('request', (req) => {
      if (req.url().includes(MEMBERS_URL) && req.method() === 'PUT') {
        putRequests.push({ method: req.method(), body: req.postData() });
      }
    });

    await expect(roleTrigger(page)).toHaveText('Student');

    await pickRole(page, 'Teacher');
    await expect(page.getByText(t('ManageMembersPage.change_role_dialog_title'))).toBeVisible();

    await page.getByRole('button', { name: t('Common.common_cancel') }).click();
    await expect(page.getByText(t('ManageMembersPage.change_role_dialog_title'))).toBeHidden();

    // Regression: the uncontrolled select used to keep showing the unconfirmed role.
    await expect(roleTrigger(page)).toHaveText('Student');
    expect(putRequests).toHaveLength(0);

    // Regression: re-picking the same role used to be a silent no-op.
    await pickRole(page, 'Teacher');
    await expect(page.getByText(t('ManageMembersPage.change_role_dialog_title'))).toBeVisible();
  });

  test('picking the role the member already has opens no dialog and sends no request', async ({
    page,
  }) => {
    const nonGetRequests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes(MEMBERS_URL) && req.method() !== 'GET') {
        nonGetRequests.push(`${req.method()} ${req.url()}`);
      }
    });

    await pickRole(page, 'Student');

    await expect(page.getByText(t('ManageMembersPage.change_role_dialog_title'))).toBeHidden();
    await expect(roleTrigger(page)).toHaveText('Student');
    expect(nonGetRequests).toHaveLength(0);
  });

  test('confirming applies the role and keeps the dropdown and the column in sync', async ({
    page,
  }) => {
    const teacherRoleId = await getRoleId(page, 'teacher');
    const memberId = '00000000-0000-4000-8001-000000000005';

    // Mock the PUT so the seed stays intact for the other parallel specs.
    const putBodies: { targetUserId: string; newOrgRoleId: string }[] = [];
    await page.route(`**${MEMBERS_URL}`, async (route) => {
      if (route.request().method() !== 'PUT') {
        await route.continue();
        return;
      }
      putBodies.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, statusCode: 200 }),
      });
    });

    await pickRole(page, 'Teacher');
    await expect(page.getByText(t('ManageMembersPage.change_role_dialog_title'))).toBeVisible();

    await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes(MEMBERS_URL) && res.request().method() === 'PUT',
      ),
      page.getByRole('button', { name: t('Common.common_confirm') }).click(),
    ]);

    await expect(page.getByText(t('ManageMembersPage.role_updated'))).toBeVisible();
    expect(putBodies).toEqual([{ targetUserId: memberId, newOrgRoleId: teacherRoleId }]);

    // Both the dropdown and the `Rola` column must agree after a confirmed change.
    await expect(roleTrigger(page)).toHaveText('Teacher');
    await expect(memberRow(page)).toContainText('teacher');
  });
});
