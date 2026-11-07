import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { shortHash } from '#test/e2e/fixtures/ids';
import { waitForDefaultAuthPath } from '@qa/fixtures/qa-mail';
import { json } from '#test/helpers/json';
import { attemptSuffix, resetInviteeState } from '@qa/fixtures/qa-invitees';
import { qaDbNow } from '@qa/fixtures/qa-db';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

// Temporary variant: only meaningful against a stack-mode Supabase.
test.skip(process.env.STUDIQ_STACK_MODE !== '1', 'temporary stack-mode variant');

/**
 * TEMPORARY: non-branded e-mail variant of ONB-08.
 *
 * Uses GoTrue's default confirmation link (stack mode cannot serve the branded
 * `content_path` template) and rebuilds the app callback from it. Remove when
 * stack mode serves branded templates (supabase/cli#7200).
 *
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
 * The invitee address is derived from the tenant key **and the attempt**
 * (`qa+<key hash>-r<retry>e<repeat>`), so independent runs never collide in the
 * shared auth schema and a CI retry inviting the same tenant creates a new
 * address instead of a duplicate invitation for the same one. Each attempt also
 * clears the case's own leftover invitations/members before it starts, so the
 * org's member capacity holds across retries. No global admin setting, feature
 * flag, plan or singleton row is read or written.
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
  const body = await json<{
    data?: Array<{ id: string; name: string; orgRoleName: string; isActive: boolean }>;
  }>(res);
  return body.data ?? [];
}

test.describe('ONB-08 — invitation link registration', () => {
  test('invitee activates an account from /join and joins with the invited role', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);

    // Everything created before this instant is a previous attempt's leftover.
    // Read it from the database clock, the one that writes the row timestamps.
    const attemptStarted = await qaDbNow();
    const tenant = loadTenant(CASE);
    expect(tenant.profile, 'ONB-08 needs the org tenant (content profile)').toBe('content');
    const org = tenant.org;
    expect(org, 'ONB-08 tenant must have an organization').toBeTruthy();

    // Unique per tenant **and attempt**: CI retries and `--repeat-each` replay
    // this test against the same seeded tenant, and a fixed address would make
    // the second invitation a duplicate pending row (a failed strict-mode
    // locator) and leave a registered account behind for the next attempt.
    const inviteePrefix = `qa+${shortHash(tenant.key)}`;
    const inviteeEmail = `${inviteePrefix}-${attemptSuffix(test.info())}@test.local`;
    const inviteeName = 'Anna Testowa';

    // --- Prerequisite MGR-INV-01: manager invites a brand-new address ------
    await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage(\/|$)/ });

    // A retry must start from the seeded state, not from the previous attempt's
    // leftovers: cancel its pending invitations and free the member slot, so the
    // org never runs into the plan's capacity on attempt 2/3.
    await resetInviteeState(page.request, (email) => email.startsWith(inviteePrefix), {
      createdBefore: attemptStarted,
    });

    await page.goto('/manage/invites');
    await expect(page.getByRole('heading', { name: 'Zaproszenia', exact: true })).toBeVisible();

    const rolesRes = await page.request.get('/api/v1/organization/roles');
    expect(rolesRes.ok(), 'GET /api/v1/organization/roles').toBe(true);
    const roles = (
      await json<{
        data?: Array<{ id: string; name: string; displayName: string }>;
      }>(rolesRes)
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

    const results = await json<{
      data?: { results?: Array<{ email: string; data?: { inviteLink?: string } }> };
    }>(bulk);
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
    await expect(pendingRow, 'exactly one pending row for the invitee').toHaveCount(1);
    await expect(pendingRow.getByText('Oczekujące', { exact: true })).toBeVisible();

    // --- Step 1: the invite link in a session-less window ------------------
    const inviteeContext: BrowserContext = await browser.newContext({ baseURL: APP_URL });
    try {
      await inviteeContext.addCookies([
        { name: 'NEXT_LOCALE', value: 'pl', domain: HOST, path: '/' },
      ]);
      const invitee = await inviteeContext.newPage();

      const anonymous = await invitee.request.get('/api/v1/auth/me');
      expect((await json<{ data?: { user: unknown } }>(anonymous)).data?.user).toBeNull();

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
      const activation = await waitForDefaultAuthPath(inviteeEmail, undefined, '/login');
      expect(activation.tokenHash, 'token_hash in the confirmation link').toBeTruthy();

      await invitee.goto(activation.path);
      await expect(invitee).toHaveURL(/\/app(\/|$)/, { timeout: 20_000 });

      const me = await json<{ data?: { user?: { email?: string } | null } }>(
        await invitee.request.get('/api/v1/auth/me'),
      );
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
      await json<{
        data?: Array<{ email: string; isAccepted: boolean }>;
      }>(acceptedRes)
    ).data;
    expect(accepted?.some((invite) => invite.email === inviteeEmail && invite.isAccepted)).toBe(
      true,
    );
  });
});
