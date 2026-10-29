import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { shortHash } from '#test/e2e/fixtures/ids';
import { waitForMailLink } from '@qa/fixtures/qa-mail';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

/**
 * ONB-08 — registration from an invitation link (/join?token=…), happy path.
 *
 * Prerequisite MGR-INV-01: the manager invites a brand-new address with the
 * `member` role through `/manage/invites`, and the spec takes the very link the
 * „Kopiuj link” button copies from the bulk response.
 *
 * The invitee then works in a **separate, session-less browser context**:
 * `/join?token=…` shows the „Verifying invitation...” skeleton, then a form with a
 * prefilled read-only e-mail, an editable name (see the #309 note in the case
 * file), a password field and „Aktywuj konto”. Submitting sends the confirmation
 * mail; the link from the mail catcher proves the address and claims the
 * invitation, so the account is a member of the inviting organization with the
 * role assigned in the invitation.
 *
 * Tenant: `bun scripts/qa-tenant.ts ONB-08 --profile content --fresh`
 * (`tenantKey`/`tenantId` from the shared seeder; a fresh run suffix per run).
 * The invitee address is derived from the tenant key, so independent runs never
 * collide in the shared auth schema and no other worker's tenant is touched. No
 * global admin setting, feature flag, plan or singleton row is read or written.
 */

const CASE = 'ONB-08';
const APP_URL = process.env.QA_APP_URL ?? 'http://localhost:3010';
const HOST = new URL(APP_URL).hostname;
const PASSWORD = 'Seed4Test!';

/** Log out of the invitee context and prove the new credentials work. */
async function relogin(invitee: Page, email: string): Promise<void> {
  const logout = await invitee.request.post('/api/v1/auth/logout');
  expect(logout.ok(), 'POST /api/v1/auth/logout').toBe(true);
  const login = await invitee.request.post('/api/v1/auth/login', {
    data: { email, password: PASSWORD },
  });
  expect(login.status(), `POST /api/v1/auth/login for ${email}`).toBe(200);
}

async function orgsOf(
  page: Page,
): Promise<Array<{ id: string; name: string; orgRoleName: string; isActive: boolean }>> {
  const res = await page.request.get('/api/v1/me/orgs');
  expect(res.ok(), 'GET /api/v1/me/orgs').toBe(true);
  const body = (await res.json()) as {
    data?: Array<{ id: string; name: string; orgRoleName: string; isActive: boolean }>;
  };
  return body.data ?? [];
}

test.describe('ONB-08 — invitation link registration', () => {
  test('invitee activates an account from /join and joins with the invited role', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);

    const tenant = loadTenant(CASE);
    expect(tenant.profile, 'ONB-08 needs the org tenant (content profile)').toBe('content');
    const org = tenant.org;
    expect(org, 'ONB-08 tenant must have an organization').toBeTruthy();

    // Unique per tenant (therefore per run suffix), deterministic from the key.
    const inviteeEmail = `qa+${shortHash(tenant.key)}@test.local`;
    const inviteeName = 'Anna Testowa';

    // --- Prerequisite MGR-INV-01: manager invites a brand-new address ------
    await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage(\/|$)/ });
    await page.goto('/manage/invites');
    await expect(page.getByRole('heading', { name: 'Zaproszenia', exact: true })).toBeVisible();

    const rolesRes = await page.request.get('/api/v1/organization/roles');
    expect(rolesRes.ok(), 'GET /api/v1/organization/roles').toBe(true);
    const roles = (
      (await rolesRes.json()) as {
        data?: Array<{ id: string; name: string; displayName: string }>;
      }
    ).data;
    const memberRole = roles?.find((role) => role.name === 'member');
    expect(memberRole, 'system org role "member"').toBeTruthy();

    await page.getByLabel('E-mail', { exact: true }).fill(inviteeEmail);
    await page.getByLabel('Rola', { exact: true }).click();
    await page.getByRole('option', { name: memberRole!.displayName, exact: true }).click();

    const bulkResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/organization/invites/bulk',
    );
    await page.getByRole('button', { name: 'Wyślij zaproszenia', exact: true }).click();
    const bulk = await bulkResponse;
    expect(bulk.status(), 'POST /api/v1/organization/invites/bulk').toBe(200);

    const results = (await bulk.json()) as {
      data?: { results?: Array<{ email: string; data?: { inviteLink?: string } }> };
    };
    const inviteLink = results.data?.results?.[0]?.data?.inviteLink;
    expect(inviteLink, 'inviteLink returned for the new invitation').toBeTruthy();
    const inviteToken = new URL(inviteLink!).searchParams.get('token');
    expect(inviteToken, 'token inside the invite link').toBeTruthy();

    // MGR-INV-01 expected result: toast, „Sukces” + „Kopiuj link”, pending row.
    await expect(page.getByText('Wysłano 1 zaproszeń.', { exact: true })).toBeVisible();
    const resultRow = page.getByTestId('invite-result-row').filter({ hasText: inviteeEmail });
    await expect(resultRow.getByText('Sukces', { exact: true })).toBeVisible();
    await expect(resultRow.getByRole('button', { name: 'Kopiuj link', exact: true })).toBeVisible();
    const pendingRow = page.locator('table tbody tr').filter({ hasText: inviteeEmail });
    await expect(pendingRow.getByText('Oczekujące', { exact: true })).toBeVisible();

    // --- Step 1: the invite link in a session-less window ------------------
    const inviteeContext: BrowserContext = await browser.newContext({ baseURL: APP_URL });
    try {
      await inviteeContext.addCookies([
        { name: 'NEXT_LOCALE', value: 'pl', domain: HOST, path: '/' },
      ]);
      const invitee = await inviteeContext.newPage();

      const anonymous = await invitee.request.get('/api/v1/auth/me');
      expect(((await anonymous.json()) as { data?: { user: unknown } }).data?.user).toBeNull();

      // Hold the token lookup long enough to observe the case's skeleton.
      await invitee.route(/\/api\/v1\/organization\/invites\?token=/, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1_200));
        await route.continue();
      });
      await invitee.goto(`/join?token=${encodeURIComponent(inviteToken!)}`);

      // --- Step 2: „Verifying invitation…”, then the form -----------------
      await expect(invitee.getByText('Verifying invitation...', { exact: true })).toBeVisible();

      await expect(invitee.getByText('Dołącz do organizacji', { exact: true })).toBeVisible();
      await expect(
        invitee.getByText('Uzupełnij swoje dane i ustaw hasło, aby aktywować konto.', {
          exact: true,
        }),
      ).toBeVisible();

      const nameInput = invitee.getByLabel('Imię i Nazwisko', { exact: true });
      const emailInput = invitee.getByLabel('Adres e-mail', { exact: true });
      const passwordInput = invitee.getByLabel('Hasło', { exact: true });

      await expect(emailInput).toHaveValue(inviteeEmail);
      await expect(emailInput).not.toBeEditable();
      // #309: the invitee supplies the name (the invitation row has no name).
      await expect(nameInput).toBeEditable();
      await expect(nameInput).toHaveValue('');
      await expect(passwordInput).toBeEditable();
      await expect(
        invitee.getByRole('button', { name: 'Aktywuj konto', exact: true }),
      ).toBeVisible();

      // --- Step 3: set a password and activate ----------------------------
      await nameInput.fill(inviteeName);
      await passwordInput.fill(PASSWORD);

      const registerResponse = invitee.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === '/api/v1/auth/register',
      );
      await invitee.getByRole('button', { name: 'Aktywuj konto', exact: true }).click();
      const registered = await registerResponse;
      expect(registered.status(), 'POST /api/v1/auth/register').toBe(202);

      await expect(invitee.getByText('Konto zostało utworzone', { exact: true })).toBeVisible();
      await expect(
        invitee.getByText('Link aktywacyjny został wysłany. Sprawdź swoją skrzynkę e-mail.', {
          exact: true,
        }),
      ).toBeVisible();
      await expect(invitee).toHaveURL(/\/login$/, { timeout: 15_000 });

      // --- Step 4: activate with the emailed link, then log in -----------
      const activation = new URL(
        await waitForMailLink(inviteeEmail, /https?:\/\/[^"'\s]+\/auth\/callback\?[^"'\s]+/),
      );
      const tokenHash = activation.searchParams.get('token_hash');
      expect(tokenHash, 'token_hash in the confirmation link').toBeTruthy();
      const type = activation.searchParams.get('type') ?? 'signup';

      // Rebuild the callback on the app under test: the harness's SiteURL may
      // differ from QA_APP_URL, the token is what matters.
      await invitee.goto(`/auth/callback?token_hash=${tokenHash}&type=${type}&next=/login`);
      await expect(invitee).toHaveURL(/\/app(\/|$)/, { timeout: 20_000 });

      const me = (await (await invitee.request.get('/api/v1/auth/me')).json()) as {
        data?: { user?: { email?: string } | null };
      };
      expect(me.data?.user?.email).toBe(inviteeEmail);

      // Membership with the role assigned in the invitation (#311).
      const orgs = await orgsOf(invitee);
      expect(orgs).toHaveLength(1);
      expect(orgs[0]).toMatchObject({
        id: org!.id,
        name: org!.name,
        orgRoleName: 'member',
        isActive: true,
      });

      await relogin(invitee, inviteeEmail);
      expect((await orgsOf(invitee)).map((entry) => [entry.id, entry.orgRoleName])).toEqual([
        [org!.id, 'member'],
      ]);
    } finally {
      await inviteeContext.close();
    }

    // The invitation was consumed, not left pending for a second accept.
    const acceptedRes = await page.request.get('/api/v1/organization/invites?isAccepted=true');
    expect(acceptedRes.ok(), 'GET /api/v1/organization/invites?isAccepted=true').toBe(true);
    const accepted = (
      (await acceptedRes.json()) as {
        data?: Array<{ email: string; isAccepted: boolean }>;
      }
    ).data;
    expect(accepted?.some((invite) => invite.email === inviteeEmail && invite.isAccepted)).toBe(
      true,
    );
  });
});
