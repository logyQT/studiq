import { expect, type Page, test } from '@playwright/test';
import { t } from '#test/e2e/utils';
import { json } from '#test/helpers/json';

const MANAGER_EMAIL = 'manager@dev.local';
const MANAGER_PASSWORD = 'pass';
const BULK_INVITES_URL = '/api/v1/organization/invites/bulk';
const STRONG_PASSWORD = 'StrongPassword1';

/**
 * Log in as the seeded WSB Merito manager and wait until the active-org cookie is
 * set (the org switcher only renders it after the auto-select POST resolved), so a
 * subsequent invites/bulk POST carries `activeOrgId`.
 */
async function loginAsManager(page: Page) {
  await page.goto('/login');
  await page.getByLabel(t('LoginPage.email_label')).fill(MANAGER_EMAIL);
  await page.getByLabel(t('LoginPage.password_label')).fill(MANAGER_PASSWORD);
  await page.getByRole('button', { name: t('LoginPage.login_button') }).click();

  await page.waitForURL(/\/manage\/?$/);
  await expect(page.getByRole('button', { name: /WSB Merito/ })).toBeVisible();
}

async function getMemberRoleId(page: Page) {
  const res = await page.request.get('/api/v1/organization/roles');
  const body = await json<{ data: { id: string; name: string }[] }>(res);
  const member = body.data.find((r) => r.name === 'member');
  expect(member, 'role "member" missing from /api/v1/organization/roles').toBeDefined();
  return member!.id;
}

/** The bulk-invite envelope fields this spec reads back. */
interface BulkInviteResponse {
  success?: boolean;
  data?: { results?: { data?: { inviteLink?: string } }[] };
}

/**
 * Create an invitation through the real API and return its 32-hex token. The
 * bulk response always carries `inviteLink` (any environment, #313), so its
 * absence is a hard failure: there is no other way to read the token back.
 */
async function createInviteToken(page: Page, email: string) {
  const roleId = await getMemberRoleId(page);

  const res = await page.request.post(BULK_INVITES_URL, {
    data: { invitations: [{ email, targetOrgRoleId: roleId }] },
  });
  const body = await json<BulkInviteResponse>(res);

  expect(res.status(), JSON.stringify(body)).toBeLessThan(300);
  expect(body.success, JSON.stringify(body)).toBe(true);

  const inviteLink = body.data?.results?.[0]?.data?.inviteLink;
  expect(
    inviteLink,
    'bulk invite did not return inviteLink (#313: the link must be returned in every environment)',
  ).toBeTruthy();

  const token = new URL(inviteLink!).searchParams.get('token');
  expect(token).toMatch(/^[0-9a-f]{32}$/);
  return token!;
}

test.describe('Join an organization — invitee supplies their name (#309)', () => {
  test('prefills the invited e-mail read-only, accepts a typed name and registers', async ({
    page,
    context,
  }) => {
    await loginAsManager(page);

    const invitedEmail = `join-${Date.now()}@example.com`;
    const token = await createInviteToken(page, invitedEmail);

    // Simulate the invitee opening the link: same browser, no session.
    await context.clearCookies();
    await page.goto(`/join?token=${token}`);

    // Regression: these three keys used to be missing from RegisterPage in both
    // locales, so the page rendered raw `RegisterPage.*` text.
    await expect(page.getByText(t('RegisterPage.join_title')).first()).toBeVisible();
    await expect(page.getByText(t('RegisterPage.join_desc')).first()).toBeVisible();

    const emailInput = page.getByLabel(t('RegisterPage.email_label'));
    await expect(emailInput).toHaveValue(invitedEmail);
    await expect(emailInput).not.toBeEditable();

    const nameInput = page.getByLabel(t('RegisterPage.name_label'));
    await expect(nameInput).toBeEditable();
    await expect(nameInput).toHaveValue('');

    await nameInput.fill('Jan Kowalski');
    await expect(nameInput).toHaveValue('Jan Kowalski');
    await page.getByLabel(t('RegisterPage.password_label')).fill(STRONG_PASSWORD);

    const registerResponse = page.waitForResponse(
      (res) => res.url().includes('/api/v1/auth/register') && res.request().method() === 'POST',
    );

    await page.getByRole('button', { name: t('RegisterPage.activate_account') }).click();

    // Regression: an empty, read-only name failed zod client-side, so no request
    // was ever sent and the form showed "Imię i nazwisko jest wymagane.".
    expect((await registerResponse).status()).toBe(202);

    await page.waitForURL(/\/login$/);
  });
});
