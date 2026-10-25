import { expect, test } from '@playwright/test';
import { t } from '#test/e2e/utils';

const PASSWORD = 'pass';
const BULK_INVITES_URL = '/api/v1/organization/invites/bulk';

async function loginAndOpenInvites(page: import('@playwright/test').Page) {
  // Register before navigation so the invites page's own roles fetch can't be missed.
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
  // switcher to render the active org — that only happens after the org switch
  // POST resolved and the orgs query refetched, so no later redirect can
  // interrupt the navigation below. Navigating straight to `?next=/manage/invites`
  // is not deterministic here: that push races the auto-select redirect.
  await page.waitForURL(/\/manage\/?$/, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: /WSB Merito/ })).toBeVisible({ timeout: 30_000 });

  await page.goto('/manage/invites');

  // Deterministic arrival: URL + form ready, then the role options.
  await page.waitForURL(/\/manage\/invites$/, { timeout: 30_000 });
  await expect(page.locator('#email-0')).toBeVisible();
  await rolesLoaded;
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
    await loginAndOpenInvites(page);
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

    // MGR-INV-02: an e-mail without a role used to be dropped silently and the
    // remaining rows were reported as a clean success. Now the row is named
    // inline and the send is blocked.
    await expect(page.locator('#row-error-1')).toHaveText(
      /Wiersz 2: wybierz rolę\.|Row 2: choose a role\./i,
    );
    await expect(page.locator('#role-1')).toHaveAttribute('aria-invalid', 'true');

    const sendButton = page.getByRole('button', {
      name: t('ManageInvitationsPage.send_invitations'),
    });
    await expect(sendButton).toBeDisabled();

    // Even a forced click must not reach the API while the batch is incomplete.
    await sendButton.click({ force: true });
    expect(bulkRequests).toBe(0);
  });

  test('an all-blank form still reports no_invites instead of a row error', async ({ page }) => {
    let bulkRequests = 0;
    page.on('request', (req) => {
      if (req.url().includes(BULK_INVITES_URL)) bulkRequests += 1;
    });

    await expect(page.locator('#row-error-0')).toHaveCount(0);

    const sendButton = page.getByRole('button', {
      name: t('ManageInvitationsPage.send_invitations'),
    });
    await expect(sendButton).toBeEnabled();
    await sendButton.click();

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
          data: { results: [{ email: 'qa-role-reset@example.com', success: true }] },
        }),
      });
    });

    await page.locator('#email-0').fill('qa-role-reset@example.com');
    await page.locator('#role-0').click();
    await page.getByRole('option', { name: 'Student', exact: true }).click();

    // Await the intercepted POST before asserting the reset state, so the
    // assertion can't race the request.
    await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes(BULK_INVITES_URL) && res.request().method() === 'POST',
      ),
      page.getByRole('button', { name: t('ManageInvitationsPage.send_invitations') }).click(),
    ]);

    await expect(page.getByText(/Wysłano 1 zaproszeń|Sent 1 invitation/i)).toBeVisible();

    expect(postedBodies).toHaveLength(1);
    expect(postedBodies[0].invitations).toEqual([
      { email: 'qa-role-reset@example.com', targetOrgRoleId: memberRoleId },
    ]);

    // Regression: the reset row used to be re-seeded with the first role (admin).
    await expect(page.locator('#email-0')).toHaveValue('');
    await expect(page.locator('#role-0')).toHaveText(roleLabel);
  });

  // MGR-INV-02: „Wyniki” used to render unattributed status badges, so a manager
  // could not tell which entered address a result belonged to.
  test('every „Wyniki” row names the e-mail it belongs to', async ({ page }) => {
    const emails = ['qa-results-a@example.com', 'qa-results-b@example.com'];

    await page.route(`**${BULK_INVITES_URL}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          statusCode: 200,
          data: {
            results: emails.map((email, index) => ({
              email,
              success: true,
              data: {
                success: true,
                invitationId: `inv-${index}`,
                inviteLink: `http://localhost:3000/join?token=token-${index}`,
              },
            })),
          },
        }),
      });
    });

    for (const [index, email] of emails.entries()) {
      if (index > 0) {
        await page.getByRole('button', { name: t('ManageInvitationsPage.add_member') }).click();
      }
      await page.locator(`#email-${index}`).fill(email);
      await page.locator(`#role-${index}`).click();
      await page.getByRole('option', { name: 'Student', exact: true }).click();
    }

    await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes(BULK_INVITES_URL) && res.request().method() === 'POST',
      ),
      page.getByRole('button', { name: t('ManageInvitationsPage.send_invitations') }).click(),
    ]);

    // Each address is rendered once and its own row carries the status/action.
    for (const email of emails) {
      const emailCell = page.getByText(email, { exact: true });
      await expect(emailCell).toHaveCount(1);

      const row = emailCell.locator('..');
      await expect(row).toContainText(t('ManageInvitationsPage.success'));
      await expect(
        row.getByRole('button', { name: t('ManageInvitationsPage.copy_link') }),
      ).toBeVisible();
    }

    // Rows keep the submitted order, so address ↔ result is unambiguous.
    const firstEmail = await page.getByText(emails[0], { exact: true }).boundingBox();
    const secondEmail = await page.getByText(emails[1], { exact: true }).boundingBox();
    expect(firstEmail!.y).toBeLessThan(secondEmail!.y);
  });
});
