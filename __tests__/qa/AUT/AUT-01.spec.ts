import { expect, test } from '@playwright/test';
import { shortHash } from '#test/e2e/fixtures/ids';
import { waitForMailLinkMatch } from '@qa/fixtures/qa-mail';
import { loadTenant } from '@qa/fixtures/qa-tenant';

/**
 * AUT-01 — student registration, happy path.
 *
 * The case registers a brand-new student, takes the activation link from the
 * mailbox, opens it and then logs in with the same credentials. Registration
 * creates the account under test, so the tenant is only a source of identity:
 *
 *   bun scripts/qa-tenant.ts AUT-01 --profile bare --role student --fresh
 *
 * The tenant's deterministic `key` (the same `tenantKey`/`shortHash` scheme as
 * the e2e fixtures) yields `qa+<shortHash>@test.local`, and `--fresh` guarantees
 * the address was never registered, so each independent run owns a new account
 * while staying reproducible. The tenant itself is `bare`/`student`: no
 * organization, no group — the same shape the fresh account gets, which is why
 * `/app` (not `/setup`) is the correct landing page.
 *
 * Polish copy is asserted because the case quotes the Polish UI; the context
 * pins `NEXT_LOCALE=pl` so a locale cookie from another case cannot change the
 * strings. The spec writes no global admin setting, feature flag, plan or
 * singleton row, and reads only the mailbox address it owns.
 */

const CASE = 'AUT-01';
const APP_URL = process.env.QA_APP_URL ?? 'http://localhost:3010';
const HOST = new URL(APP_URL).hostname;
const NAME = 'Test Student';
const PASSWORD = 'Haslo1234';

const UI = {
  registerTitle: 'Utwórz konto',
  nameLabel: 'Imię i Nazwisko',
  emailLabel: 'Adres e-mail',
  accountLabel: 'Jestem',
  passwordLabel: 'Hasło',
  studentOption: 'Uczniem',
  registerButton: 'Zarejestruj się',
  successTitle: 'Konto zostało utworzone',
  activationSent: 'Link aktywacyjny został wysłany. Sprawdź swoją skrzynkę e-mail.',
  backToLogin: 'Przejdź do logowania',
  loginTitle: 'Witaj ponownie',
  loginButton: 'Zaloguj się',
} as const;

test.describe('AUT-01 — student registration', () => {
  test('registers, activates from the e-mail and logs in to /app', async ({ page }) => {
    test.setTimeout(180_000);

    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the bare tenant profile`).toBe('bare');
    expect(tenant.role, `${CASE} needs a bare student`).toBe('student');
    expect(tenant.org, 'the bare tenant must not own an organization').toBeNull();
    expect(
      tenant.runSuffix,
      'seed with --fresh: the registered address must not exist yet',
    ).toBeTruthy();

    // Deterministic per run, never shared with another tenant (same helper the
    // invite flow uses for its brand-new address).
    const email = `qa+${shortHash(tenant.key)}@test.local`;

    // No stored session and the Polish UI the case describes.
    await page
      .context()
      .addCookies([{ name: 'NEXT_LOCALE', value: 'pl', domain: HOST, path: '/' }]);

    // --- Step 1: open /register -----------------------------------------
    await page.goto('/register');
    await expect(page.getByText(UI.registerTitle, { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/register$/);

    // --- Step 2: name, e-mail, password ---------------------------------
    const nameInput = page.getByLabel(UI.nameLabel, { exact: true });
    const emailInput = page.getByLabel(UI.emailLabel, { exact: true });
    const passwordInput = page.getByLabel(UI.passwordLabel, { exact: true });

    await expect(nameInput).toBeEditable();
    await nameInput.fill(NAME);
    await emailInput.fill(email);
    await passwordInput.fill(PASSWORD);
    await expect(nameInput).toHaveValue(NAME);
    await expect(emailInput).toHaveValue(email);

    // --- Step 3: „Jestem” → „Uczniem”, submit ----------------------------
    await expect(page.getByText(UI.accountLabel, { exact: true })).toBeVisible();
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: UI.studentOption }).click();

    const registerResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/auth/register',
    );
    await page.getByRole('button', { name: UI.registerButton, exact: true }).click();
    const registered = await registerResponse;
    expect(registered.status(), 'POST /api/v1/auth/register').toBe(202);

    // Expected result 1: the activation card replaces the form.
    await expect(page.getByText(UI.successTitle, { exact: true })).toBeVisible();
    await expect(page.getByText(UI.activationSent, { exact: true })).toBeVisible();
    await expect(nameInput).toHaveCount(0);
    const backToLogin = page.getByRole('link', { name: UI.backToLogin, exact: true });
    await expect(backToLogin).toBeVisible();
    await expect(backToLogin).toHaveAttribute('href', '/login');

    // Expected result 2: exactly one confirmation message with one link.
    const mail = await waitForMailLinkMatch(
      email,
      /https?:\/\/[^"'\s]+\/auth\/callback\?[^"'\s]+/,
      60_000,
    );
    expect(mail.messageCount, `exactly one message for ${email}`).toBe(1);

    const activation = new URL(mail.link);
    const tokenHash = activation.searchParams.get('token_hash');
    expect(tokenHash, 'token_hash in the confirmation link').toBeTruthy();
    expect(activation.searchParams.get('type'), 'confirmation link type').toBe('signup');

    // --- Step 4: open the activation link --------------------------------
    // Rebuild the callback on the app under test (the harness's SiteURL may
    // differ); the token is what matters.
    await page.goto(
      `/auth/callback?token_hash=${encodeURIComponent(tokenHash!)}&type=signup&next=/login`,
    );

    // Expected result 3: the link proves the address and establishes a session
    // without an error — the case allows /login, the confirmed behaviour is the
    // direct student panel.
    await expect(page).toHaveURL(/\/app(\/|$)/, { timeout: 20_000 });
    await expect(page).not.toHaveURL(/[?&]error=/);

    const meResponse = await page.request.get('/api/v1/auth/me');
    expect(meResponse.ok(), 'GET /api/v1/auth/me after activation').toBe(true);
    const me = (await meResponse.json()) as { data?: { user?: { email?: string } | null } };
    expect(me.data?.user?.email, 'the activated session belongs to the registered address').toBe(
      email,
    );

    // A standalone student: no organization, so nothing pushes the panel to /setup.
    const orgsResponse = await page.request.get('/api/v1/me/orgs');
    expect(orgsResponse.ok(), 'GET /api/v1/me/orgs').toBe(true);
    expect(((await orgsResponse.json()) as { data?: unknown[] }).data).toEqual([]);

    // --- Step 5: log in again with the step-2 credentials ----------------
    const logout = await page.request.post('/api/v1/auth/logout');
    expect(logout.ok(), 'POST /api/v1/auth/logout').toBe(true);

    await page.goto('/login');
    await expect(page.getByText(UI.loginTitle, { exact: true })).toBeVisible();
    await page.getByLabel(UI.emailLabel, { exact: true }).fill(email);
    await page.getByLabel(UI.passwordLabel, { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: UI.loginButton, exact: true }).click();

    // Expected result 4: the student panel, not an error or the /setup gate.
    await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Cześć');
    await expect(page.getByText(/ERROR_/)).toHaveCount(0);
  });
});
