import { expect, test, type Page, type Response } from '@playwright/test';
import { shortHash } from '#test/e2e/fixtures/ids';
import { waitForMailLinkMatch } from '@qa/fixtures/qa-mail';
import { loadTenant } from '@qa/fixtures/qa-tenant';

/**
 * AUT-13 — ustawienie nowego hasła z linku resetującego.
 *
 * Prerequisite (reconciled with the tenant seeder): the recovery link from
 * AUT-12 for an existing, confirmed student account. The tenant supplies that
 * account and a fresh run suffix:
 *
 *   bun scripts/qa-tenant.ts AUT-13 --fresh
 *
 * `--fresh` folds a run suffix into the tenant key, so every independent run
 * owns a brand-new confirmed student (`tenantKey` + `shortHash`, the same scheme
 * as the e2e fixtures) whose password is still the seeded `Seed4Test!`. The spec
 * never uses the legacy manual `@dev.local` accounts and never touches shared
 * global rows (settings, feature flags, plans, platform stats).
 *
 * The case uses the literal passwords „Nowe1234” / „Inne1234”. The spec derives
 * both from the tenant key instead, so a run never collides with a password the
 * account already has (Supabase rejects `same_password` with 422) and the
 * mismatch is guaranteed to differ from the new password while staying
 * deterministic:
 *
 *   new      = `Nowe1234<shortHash(tenant.key).slice(0, 4)>`
 *   mismatch = `Inne1234<shortHash(tenant.key).slice(0, 4)>`
 *
 * Acceptance criteria (case): mismatched confirmation shows „Podane hasła nie są
 * identyczne.”; a correct save shows „Hasło zostało zmienione. Witaj z
 * powrotem!” and redirects to the panel (a standalone student lands on `/app`);
 * the new password works and the old one is rejected. The last step also proves
 * the old password is gone — the case's note about restoring it applies only to
 * the legacy shared seed account, not to this run's own tenant.
 *
 * Polish copy is asserted because the case quotes the Polish UI; `NEXT_LOCALE=pl`
 * is pinned so a locale cookie from another case cannot change the strings. The
 * only mailbox read is the recovery message addressed to this run's own tenant
 * account.
 *
 * Adjacent regression on the same surface: a session created by a plain password
 * login must not be able to change the password without the current one — only a
 * fresh recovery-OTP session authorises the reset form's request. The spec checks
 * that after step 4's login, a body without `currentPassword` is refused with
 * 400 `BAD_REQUEST`.
 */

const CASE = 'AUT-13';
const HOST = new URL(process.env.QA_APP_URL ?? 'http://localhost:3010').hostname;

const SEEDED_PASSWORD = 'Seed4Test!';

const COPY = {
  resetTitle: 'Zapomniałeś hasła?',
  emailLabel: 'E-mail',
  resetButton: 'Wyślij link',
  resetSent: 'Instrukcje zostały wysłane. Sprawdź swoją skrzynkę e-mail.',
  updateTitle: 'Ustaw nowe hasło',
  updateDescription:
    'Twoja tożsamość została zweryfikowana. Możesz teraz ustawić nowe bezpieczne hasło.',
  newPasswordLabel: 'Nowe hasło',
  confirmPasswordLabel: 'Potwierdź nowe hasło',
  mismatch: 'Podane hasła nie są identyczne.',
  saveButton: 'Zapisz hasło',
  passwordChanged: 'Hasło zostało zmienione. Witaj z powrotem!',
  loginTitle: 'Witaj ponownie',
  loginButton: 'Zaloguj się',
  loginRejected: 'Nieprawidłowy adres e-mail lub hasło.',
} as const;

const UPDATE_PASSWORD_PATH = '/api/v1/auth/password/update';
const RESET_PASSWORD_PATH = '/api/v1/auth/password/reset';
const LOGIN_PATH = '/api/v1/auth/login';
const RECOVERY_LINK = /https?:\/\/[^"'\s]+\/auth\/callback\?[^"'\s]+/;

/** Anonymous visit with the Polish locale the case quotes. */
async function pinLocale(page: Page): Promise<void> {
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'pl', domain: HOST, path: '/' }]);
}

const isPost = (path: string) => (response: Response) =>
  response.request().method() === 'POST' && new URL(response.url()).pathname === path;

async function expectAnonymous(page: Page): Promise<void> {
  const response = await page.request.get('/api/v1/auth/me');
  expect(response.status(), 'GET /api/v1/auth/me').toBe(200);
  const body = (await response.json()) as { data: { user: unknown; session: unknown } };
  expect(body.data.user, 'no authenticated user').toBeNull();
  expect(body.data.session, 'no authenticated session').toBeNull();
}

/** Step 1 of AUT-12: request the recovery mail for this run's own account. */
async function requestRecoveryLink(page: Page, email: string): Promise<void> {
  await page.goto('/password/reset');
  await expect(page).toHaveURL(/\/password\/reset$/);
  await expect(page.getByText(COPY.resetTitle, { exact: true })).toBeVisible();

  await page.locator('input[name=email]').fill(email);

  const responsePromise = page.waitForResponse(isPost(RESET_PASSWORD_PATH));
  await page.getByRole('button', { name: COPY.resetButton, exact: true }).click();
  const response = await responsePromise;
  expect(response.status(), `POST ${RESET_PASSWORD_PATH}`).toBe(200);
  expect(await response.json()).toMatchObject({ success: true });

  // Expected (AUT-12): the form is replaced by the confirmation alert.
  await expect(page.getByText(COPY.resetSent, { exact: true })).toBeVisible();
  await expect(page.locator('input[name=email]')).toHaveCount(0);
}

/** Step 1–2: open the recovery link and land on the /password/update form. */
async function openRecoveryLink(page: Page, email: string): Promise<string> {
  const mail = await waitForMailLinkMatch(email, RECOVERY_LINK, 60_000);
  expect(mail.messageCount, `exactly one message for ${email}`).toBe(1);

  const link = new URL(mail.link);
  expect(link.pathname, 'recovery callback').toBe('/auth/callback');
  expect(link.searchParams.get('token_hash'), 'token_hash in the recovery link').toBeTruthy();
  expect(link.searchParams.get('type'), 'recovery link type').toBe('recovery');
  expect(link.searchParams.get('next'), 'the link targets the update form').toBe(
    '/password/update',
  );

  // Rebuild the callback on the app under test (a shared stack's SiteURL may
  // differ); the single-use token is what matters.
  await page.goto(`${link.pathname}${link.search}`);
  return link.searchParams.get('token_hash')!;
}

/** Step 2–3 of the case: mismatched confirmation, then the correct save. */
async function setNewPassword(page: Page, newPassword: string, mismatch: string): Promise<void> {
  // Every response of the update endpoint, so the mismatch can be proven not to
  // have changed anything even if the client decided to ask the server.
  const statuses: number[] = [];
  page.on('response', (response) => {
    if (isPost(UPDATE_PASSWORD_PATH)(response)) statuses.push(response.status());
  });

  await expect(page).toHaveURL(/\/password\/update$/);
  await expect(page.getByText(COPY.updateTitle, { exact: true })).toBeVisible();
  await expect(page.getByText(COPY.updateDescription, { exact: true })).toBeVisible();
  // The reset flow is authorised by the recovery session, so the form must not
  // ask for the current password.
  await expect(page.locator('input[name=currentPassword]')).toHaveCount(0);

  const passwordInput = page.locator('input[name=password]');
  const confirmInput = page.locator('input[name=confirmPassword]');
  await expect(passwordInput).toBeEditable();
  await expect(confirmInput).toBeEditable();
  await expect(page.getByText(COPY.newPasswordLabel, { exact: true })).toBeVisible();
  await expect(page.getByText(COPY.confirmPasswordLabel, { exact: true })).toBeVisible();

  // --- Step 2: „Nowe1234” / „Inne1234” ---------------------------------
  await passwordInput.fill(newPassword);
  await confirmInput.fill(mismatch);
  await page.getByRole('button', { name: COPY.saveButton, exact: true }).click();

  // Expected result: the confirmation field reports the mismatch and nothing is
  // written — no successful update response, no success toast, no redirect.
  const mismatchMessage = page.getByText(COPY.mismatch, { exact: true });
  await expect(mismatchMessage).toBeVisible();
  await expect(page).toHaveURL(/\/password\/update$/);
  expect(
    statuses.filter((status) => status < 300),
    'a mismatched confirmation must not update the password',
  ).toEqual([]);
  await expect(page.getByText(COPY.passwordChanged, { exact: true })).toHaveCount(0);

  // --- Step 3: fix the confirmation and save ----------------------------
  await confirmInput.fill(newPassword);
  await expect(mismatchMessage).toHaveCount(0);
  await expect(confirmInput).toHaveValue(newPassword);

  const toast = page.locator('[data-sonner-toast]').filter({ hasText: COPY.passwordChanged });
  const responsePromise = page.waitForResponse(isPost(UPDATE_PASSWORD_PATH));
  await page.getByRole('button', { name: COPY.saveButton, exact: true }).click();

  // Start both waits before the request settles: sonner keeps the toast for 4 s,
  // and the API answers in a few seconds on the shared box.
  const [response] = await Promise.all([
    responsePromise,
    expect(toast, 'success toast after the password change').toBeVisible({ timeout: 30_000 }),
  ]);
  expect(response.status(), `POST ${UPDATE_PASSWORD_PATH}`).toBe(200);
  expect(response.headers()['x-error-code'], 'no error code on success').toBeUndefined();
  expect(await response.json()).toMatchObject({ success: true });

  // Expected result: redirect to the panel (a standalone student: /app).
  await expect(page).toHaveURL(/\/app$/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Cześć');
  const body = await page.locator('body').innerText();
  expect(body, 'no raw translation key or error code on screen').not.toMatch(
    /\bERROR_[A-Z_]+\b|\bBAD_REQUEST\b/,
  );
}

/** Step 4: log out, then log in through the form with the given password. */
async function logoutAndLogin(
  page: Page,
  email: string,
  password: string,
): Promise<{ response: Response; toast: ReturnType<Page['locator']> }> {
  const logout = await page.request.post('/api/v1/auth/logout');
  expect(logout.status(), 'POST /api/v1/auth/logout').toBe(200);
  await expectAnonymous(page);

  await page.goto('/login');
  await expect(page.getByText(COPY.loginTitle, { exact: true })).toBeVisible();
  await page.locator('input[name=email]').fill(email);
  await page.locator('input[name=password]').fill(password);

  const toast = page.locator('[data-sonner-toast]').filter({ hasText: COPY.loginRejected });
  const responsePromise = page.waitForResponse(isPost(LOGIN_PATH));
  await page.getByRole('button', { name: COPY.loginButton, exact: true }).click();
  const response = await responsePromise;
  return { response, toast };
}

test.describe('AUT-13 — set a new password from the recovery link', () => {
  test('mismatch is rejected, the save redirects to /app, new password works and the old one does not', async ({
    page,
  }) => {
    test.setTimeout(240_000);

    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the bare tenant profile`).toBe('bare');
    expect(tenant.role, `${CASE} needs a bare student`).toBe('student');
    expect(tenant.org, 'the bare tenant must not own an organization').toBeNull();
    expect(
      tenant.runSuffix,
      'seed with --fresh: the account password must still be the seeded one',
    ).toBeTruthy();

    const student = tenant.users.student;
    expect(student, `${CASE} must seed the bare student`).toBeTruthy();
    expect(student!.password, 'the seeded password under test').toBe(SEEDED_PASSWORD);

    const email = student!.email;
    const suffix = shortHash(tenant.key).slice(0, 4);
    const newPassword = `Nowe1234${suffix}`;
    const mismatch = `Inne1234${suffix}`;

    await pinLocale(page);
    await expectAnonymous(page);

    // --- Prerequisite AUT-12: request the recovery link -------------------
    await requestRecoveryLink(page, email);

    // --- Step 1: open the link from the message --------------------------
    const tokenHash = await openRecoveryLink(page, email);
    expect(tokenHash, 'a single-use recovery token').toBeTruthy();

    // --- Steps 2–3: mismatch, then the correct save ----------------------
    await setNewPassword(page, newPassword, mismatch);

    // The recovery session now belongs to the same account.
    const me = await page.request.get('/api/v1/auth/me');
    expect(me.status(), 'GET /api/v1/auth/me after the password change').toBe(200);
    expect(
      ((await me.json()) as { data?: { user?: { email?: string } | null } }).data?.user?.email,
    ).toBe(email);

    // --- Step 4a: the new password logs in -------------------------------
    const accepted = await logoutAndLogin(page, email, newPassword);
    expect(accepted.response.status(), 'POST /api/v1/auth/login with the new password').toBe(200);
    await expect(page).toHaveURL(/\/app$/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Cześć');
    await expect(accepted.toast).toHaveCount(0);

    // --- Adjacent: a plain login session cannot change the password ------
    // The reset form authorises itself with the recovery OTP session; a normal
    // session must still prove the current password, which this body omits.
    const guard = await page.request.post(UPDATE_PASSWORD_PATH, {
      data: { password: `Obce1234${suffix}`, confirmPassword: `Obce1234${suffix}` },
    });
    expect(guard.status(), `POST ${UPDATE_PASSWORD_PATH} without currentPassword`).toBe(400);
    expect(guard.headers()['x-error-code'], 'app error code').toBe('BAD_REQUEST');
    expect(await guard.json(), 'refused, nothing written').toMatchObject({
      success: false,
      error: 'BAD_REQUEST',
    });

    // --- Step 4b: the old password is rejected ---------------------------
    const rejected = await logoutAndLogin(page, email, SEEDED_PASSWORD);
    expect(rejected.response.status(), 'POST /api/v1/auth/login with the old password').toBe(401);
    expect(rejected.response.headers()['x-error-code'], 'app error code').toBe('UNAUTHORIZED');
    expect(await rejected.response.json()).toMatchObject({
      success: false,
      error: 'UNAUTHORIZED',
    });
    await expect(rejected.toast, 'readable rejection message').toHaveText(COPY.loginRejected);

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText(COPY.loginTitle, { exact: true })).toBeVisible();
    await expectAnonymous(page);
    await page.goto('/app');
    await expect(page).toHaveURL(/\/login\?next=%2Fapp$/);
  });
});
