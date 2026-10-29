import { expect, test, type Page, type Response } from '@playwright/test';
import { shortHash } from '#test/e2e/fixtures/ids';
import { waitForMailLinkMatch } from '@qa/fixtures/qa-mail';
import { loadTenant } from '@qa/fixtures/qa-tenant';

/**
 * AUT-06 — Brak aktywacji konta uniemożliwia logowanie.
 *
 * Prerequisite (reconciled with the tenant seeder): a freshly registered account
 * whose activation link was never opened. Registration creates that account, so
 * the tenant supplies the deterministic identity and a fresh run suffix:
 *
 *   bun scripts/qa-tenant.ts AUT-06 --profile bare --role student --fresh
 *
 * The tenant's `key` (`tenantKey`/`shortHash`, the same scheme as the e2e
 * fixtures) yields `qa+<shortHash>+aut06@test.local`; `--fresh` guarantees the
 * address was never registered, so each independent run owns a brand-new,
 * unconfirmed account. The `bare`/`student` tenant also provides the
 * **confirmed** account used by the adjacent regression test: the same login
 * form must still let a verified user in, so the rejection is proven to be
 * specific to an unconfirmed address rather than a blanket login failure.
 *
 * Expected result (case): login is rejected with a readable message and the user
 * gets no session. The product deliberately answers every GoTrue failure with
 * `UNAUTHORIZED` / „Nieprawidłowy adres e-mail lub hasło.” (no account
 * enumeration); the case allows a generic wording („Logowanie nie powiodło
 * się…”) as long as the message is readable, so the spec asserts that copy, the
 * 401 code and the absence of any session — not a confirmation-specific string.
 *
 * Polish copy is asserted because the case quotes the Polish UI; the context
 * pins `NEXT_LOCALE=pl` so a locale cookie left by another case cannot change the
 * strings. Nothing global is read or written: no settings, feature flags, plans,
 * platform rows or another tenant. The only mailbox read is the message
 * addressed to this run's own deterministic address.
 */

const CASE = 'AUT-06';
const HOST = new URL(process.env.QA_APP_URL ?? 'http://localhost:3010').hostname;

const NAME = 'Test Student';
const PASSWORD = 'Seed4Test!';

const COPY = {
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
  rejected: 'Nieprawidłowy adres e-mail lub hasło.',
} as const;

/** Supabase session cookies are chunked in production (`…-auth-token.0`). */
const SESSION_COOKIE = /^sb-.*-auth-token(?:\.\d+)?$/;

const isAuthPost = (path: string) => (response: Response) =>
  response.request().method() === 'POST' && new URL(response.url()).pathname === path;

const isRegisterPost = isAuthPost('/api/v1/auth/register');
const isLoginPost = isAuthPost('/api/v1/auth/login');

/** Anonymous visit with the Polish locale the case quotes. */
async function pinLocale(page: Page): Promise<void> {
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'pl', domain: HOST, path: '/' }]);
}

async function sessionCookieNames(page: Page): Promise<string[]> {
  return (await page.context().cookies())
    .map((cookie) => cookie.name)
    .filter((name) => SESSION_COOKIE.test(name));
}

/**
 * The on-screen precondition and the second acceptance point: the caller has no
 * session. `/api/v1/auth/me` answers 200 with `user: null` when anonymous, so the
 * check is the cookie jar *and* the server's own view of the caller.
 */
async function expectNoSession(page: Page): Promise<void> {
  const response = await page.request.get('/api/v1/auth/me');
  expect(response.status(), 'GET /api/v1/auth/me').toBe(200);
  const body = (await response.json()) as {
    success: boolean;
    data: { user: unknown; session: unknown };
  };
  expect(body.success).toBe(true);
  expect(body.data.user, 'no authenticated user').toBeNull();
  expect(body.data.session, 'no authenticated session').toBeNull();
  expect(await sessionCookieNames(page), 'no Supabase session cookie').toEqual([]);
}

/** Step 1 of the case: register the account and never open its activation link. */
async function registerWithoutActivating(page: Page, email: string): Promise<void> {
  await page.goto('/register');
  await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByText(COPY.registerTitle, { exact: true })).toBeVisible();

  await page.getByLabel(COPY.nameLabel, { exact: true }).fill(NAME);
  await page.getByLabel(COPY.emailLabel, { exact: true }).fill(email);
  await expect(page.getByText(COPY.accountLabel, { exact: true })).toBeVisible();
  await page.getByRole('combobox').click();
  await page.getByRole('option', { name: COPY.studentOption }).click();
  await page.getByLabel(COPY.passwordLabel, { exact: true }).fill(PASSWORD);

  const responsePromise = page.waitForResponse(isRegisterPost);
  await page.getByRole('button', { name: COPY.registerButton, exact: true }).click();
  const response = await responsePromise;
  expect(response.status(), 'POST /api/v1/auth/register').toBe(202);

  // The success card replaces the form; the account still needs activation, and
  // registration must not establish a session on its own.
  await expect(page.getByText(COPY.successTitle, { exact: true })).toBeVisible();
  await expect(page.getByText(COPY.activationSent, { exact: true })).toBeVisible();
  await expect(page.getByLabel(COPY.nameLabel, { exact: true })).toHaveCount(0);
  await expectNoSession(page);
}

/** Step 2 of the case: try to log in with the credentials from step 1. */
async function submitLogin(
  page: Page,
  email: string,
  password: string,
): Promise<{ response: Response; toast: ReturnType<Page['locator']> }> {
  await page.getByLabel(COPY.emailLabel, { exact: true }).fill(email);
  await page.getByLabel(COPY.passwordLabel, { exact: true }).fill(password);

  const toast = page.locator('[data-sonner-toast]').filter({ hasText: COPY.rejected });
  const responsePromise = page.waitForResponse(isLoginPost);
  await page.getByRole('button', { name: COPY.loginButton, exact: true }).click();

  // Start waiting for the toast before the response settles: sonner keeps it
  // on screen for 4 s, so a late assertion could miss it.
  const [response] = await Promise.all([responsePromise, expect(toast).toBeVisible()]);
  return { response, toast };
}

test.describe('AUT-06 — an unconfirmed account cannot log in', () => {
  test('registration stays unconfirmed, login is rejected and no session is created', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the bare tenant profile`).toBe('bare');
    expect(tenant.role, `${CASE} needs a bare student`).toBe('student');
    expect(tenant.org, 'the bare tenant must not own an organization').toBeNull();
    expect(
      tenant.runSuffix,
      'seed with --fresh: the registered address must not exist yet',
    ).toBeTruthy();

    // Deterministic per run, never shared with another tenant.
    const email = `qa+${shortHash(tenant.key)}+aut06@test.local`;

    await pinLocale(page);
    await expectNoSession(page);
    await registerWithoutActivating(page, email);

    // The activation mail proves the account exists and still awaits
    // confirmation — the case's "link nieużyty" prerequisite. It is never opened.
    const mail = await waitForMailLinkMatch(
      email,
      /https?:\/\/[^"'\s]+\/auth\/callback\?[^"'\s]+/,
      60_000,
    );
    expect(mail.messageCount, `exactly one message for ${email}`).toBe(1);
    const activation = new URL(mail.link);
    expect(activation.searchParams.get('token_hash'), 'token_hash in the link').toBeTruthy();
    expect(activation.searchParams.get('type'), 'confirmation link type').toBe('signup');

    // --- Step 2: log in without having activated the account --------------
    await page.getByRole('link', { name: COPY.backToLogin, exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText(COPY.loginTitle, { exact: true })).toBeVisible();

    const { response, toast } = await submitLogin(page, email, PASSWORD);

    // Expected result: rejected by the API …
    expect(response.status(), 'POST /api/v1/auth/login for an unconfirmed account').toBe(401);
    expect(response.headers()['x-error-code'], 'app error code').toBe('UNAUTHORIZED');
    expect(await response.json(), 'login response body').toMatchObject({
      success: false,
      error: 'UNAUTHORIZED',
    });

    // … with a readable message (never a raw code or stack trace) …
    await expect(toast).toHaveText(COPY.rejected);
    const body = await page.locator('body').innerText();
    expect(body, 'no raw translation key or error code on screen').not.toMatch(
      /\bERROR_[A-Z_]+\b|\bUNAUTHORIZED\b/,
    );
    expect(body, 'no stack trace on screen').not.toMatch(/\n\s+at [\w$.]+ \(/);

    // … and a form that stays on /login, still anonymous.
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText(COPY.loginTitle, { exact: true })).toBeVisible();
    await expectNoSession(page);

    // Expected result: no session for the user — a protected dashboard bounces
    // back to the login form instead of rendering.
    await page.goto('/app');
    await expect(page).toHaveURL(/\/login\?next=%2Fapp$/);
    await expectNoSession(page);
  });

  test('a confirmed account with the same form still logs in and receives a session', async ({
    page,
  }) => {
    const tenant = loadTenant(CASE);
    const student = tenant.users.student;
    expect(student, `${CASE} must seed the confirmed bare student`).toBeTruthy();

    await pinLocale(page);
    await expectNoSession(page);
    await page.goto('/login');
    await expect(page.getByText(COPY.loginTitle, { exact: true })).toBeVisible();

    const responsePromise = page.waitForResponse(isLoginPost);
    await page.getByLabel(COPY.emailLabel, { exact: true }).fill(student!.email);
    await page.getByLabel(COPY.passwordLabel, { exact: true }).fill(student!.password);
    await page.getByRole('button', { name: COPY.loginButton, exact: true }).click();
    const response = await responsePromise;
    expect(response.status(), 'POST /api/v1/auth/login for a confirmed account').toBe(200);

    // The same redirect a verified student gets: the student panel.
    await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Cześć');
    expect(
      await sessionCookieNames(page),
      'session cookie after a confirmed login',
    ).not.toHaveLength(0);

    const me = await page.request.get('/api/v1/auth/me');
    expect(me.status(), 'GET /api/v1/auth/me after login').toBe(200);
    const body = (await me.json()) as { data?: { user?: { email?: string } | null } };
    expect(body.data?.user?.email, 'the session belongs to the confirmed account').toBe(
      student!.email,
    );
  });
});
