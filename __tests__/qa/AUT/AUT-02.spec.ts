import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { shortHash } from '#test/e2e/fixtures/ids';
import { waitForMailLink } from '@qa/fixtures/qa-mail';
import { loadTenant } from '@qa/fixtures/qa-tenant';

/**
 * AUT-02 — Rejestracja nauczyciela i managera.
 *
 * Both accounts are created by the test itself through `/register`, because a
 * registration case has by definition no pre-existing account. The case tenant is
 * still the isolated, deterministic one (`qa/cases/AUT-02.md` profile `bare`):
 *
 *   bun scripts/qa-tenant.ts AUT-02 --profile bare --fresh
 *
 * It contributes the run-suffixed `tenantKey`, from which the two fresh addresses
 * are derived (`qa+<shortHash>-educator@test.local`, `…-manager@…`). A fresh run
 * suffix therefore means fresh addresses on every run, while ids stay
 * deterministic; the seeded bare account itself is never signed in.
 *
 * The acceptance points are the intended post-login destinations — educator →
 * `/setup` (ONB-01), manager → `/setup/org` (ONB-04) — and the account type in the
 * issued token. Activation uses the confirmation mail read from the shared stack's
 * mail catcher (read-only, filtered to this run's own address).
 *
 * Polish copy is asserted because the case quotes the Polish UI; the fixture pins
 * `NEXT_LOCALE=pl` so a locale cookie from an earlier case cannot change it.
 */

const CASE = 'AUT-02';
const APP_URL = process.env.QA_APP_URL ?? 'http://localhost:3010';
const HOST = new URL(APP_URL).hostname;
/** The case's own password (step 1/2). */
const PASSWORD = 'Haslo1234';
const CONFIRMATION_LINK = /https?:\/\/[^"'\s]+\/auth\/callback\?[^"'\s]+/;

const COPY = {
  createAccount: 'Utwórz konto',
  name: 'Imię I Nazwisko',
  email: 'Adres e-mail',
  password: 'Hasło',
  register: 'Zarejestruj się',
  signIn: 'Zaloguj się',
  successTitle: 'Konto zostało utworzone',
  successMessage: 'Link aktywacyjny został wysłany. Sprawdź swoją skrzynkę e-mail.',
  optionStudent: /^Uczniem/,
  optionEducator: /^Nauczycielem/,
  optionManager: /^Menedżerem/,
  setupTitle: 'Witaj w StudiQ',
  setupOrgTitle: 'Skonfiguruj swoją organizację',
} as const;

interface Registration {
  name: string;
  email: string;
  option: RegExp;
}

function tenantTag(): string {
  return shortHash(loadTenant(CASE).key);
}

/** Step 1/2: fill `/register` as an anonymous visitor and select the account type. */
async function registerAccount(page: Page, registration: Registration): Promise<void> {
  await page.goto('/register');
  await expect(page.locator('[data-slot="card-title"]')).toHaveText(COPY.createAccount);

  await page.getByLabel(COPY.name).fill(registration.name);
  await page.getByLabel(COPY.email).fill(registration.email);

  // Exactly the three account types from the case; the selected one is the one
  // that ends up in the token (asserted after login).
  await page.getByRole('combobox').click();
  await expect(page.getByRole('option')).toHaveCount(3);
  await expect(page.getByRole('option', { name: COPY.optionStudent })).toBeVisible();
  await expect(page.getByRole('option', { name: COPY.optionEducator })).toBeVisible();
  await expect(page.getByRole('option', { name: COPY.optionManager })).toBeVisible();
  await page.getByRole('option', { name: registration.option }).click();

  await page.getByLabel(COPY.password).fill(PASSWORD);

  const submitted = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/v1/auth/register',
  );
  await page.getByRole('button', { name: COPY.register, exact: true }).click();

  const response = await submitted;
  expect(response.status(), 'POST /api/v1/auth/register').toBe(202);
  expect(await response.json()).toMatchObject({
    success: true,
    data: { message: 'SUCCESS_ACTIVATION_LINK_SENT' },
  });

  await expect(page.getByText(COPY.successTitle, { exact: true })).toBeVisible();
  await expect(page.getByText(COPY.successMessage, { exact: true })).toBeVisible();
}

/** Step 3: the emailed confirmation link, rebuilt against the app under test. */
async function confirmationPath(email: string): Promise<string> {
  const link = new URL(await waitForMailLink(email, CONFIRMATION_LINK));
  const tokenHash = link.searchParams.get('token_hash');
  const type = link.searchParams.get('type') ?? 'signup';
  expect(tokenHash, 'token_hash in the confirmation link').toBeTruthy();
  expect(type, 'confirmation link type').toBe('signup');
  return `/auth/callback?token_hash=${encodeURIComponent(tokenHash!)}&type=${type}&next=/login`;
}

/** A session-less context for the freshly registered user (one account per context). */
async function userContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: APP_URL });
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'pl', domain: HOST, path: '/' }]);
  return context;
}

/** Log in through the form, exactly like the returning user in the case. */
async function signIn(page: Page, email: string, destination: RegExp): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(COPY.email).fill(email);
  await page.getByLabel(COPY.password).fill(PASSWORD);

  const submitted = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/v1/auth/login',
  );
  await page.getByRole('button', { name: COPY.signIn, exact: true }).click();

  const response = await submitted;
  expect(response.status(), 'POST /api/v1/auth/login').toBe(200);
  await expect(page).toHaveURL(destination, { timeout: 20_000 });
}

/** The `account_type` claim carried by the session's access token. */
async function tokenClaims(context: BrowserContext): Promise<{
  email?: string;
  accountType?: string;
}> {
  const chunks = (await context.cookies(APP_URL))
    .filter((cookie) => /^sb-.*-auth-token(\.\d+)?$/.test(cookie.name))
    .sort((a, b) => {
      const index = (name: string) => Number(name.match(/\.(\d+)$/)?.[1] ?? 0);
      return index(a.name) - index(b.name);
    });
  expect(chunks.length, 'Supabase auth cookie').toBeGreaterThan(0);

  const raw = chunks
    .map((cookie) => cookie.value)
    .join('')
    .replace(/^base64-/, '');
  const session = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as {
    access_token?: string;
  };
  expect(session.access_token, 'access token in the session cookie').toBeTruthy();

  const payload = JSON.parse(
    Buffer.from(session.access_token!.split('.')[1], 'base64url').toString('utf8'),
  ) as { email?: string; app_metadata?: { account_type?: string } };
  return { email: payload.email, accountType: payload.app_metadata?.account_type };
}

async function organizationsOf(page: Page): Promise<unknown[]> {
  const response = await page.request.get('/api/v1/me/orgs');
  expect(response.status(), 'GET /api/v1/me/orgs').toBe(200);
  const body = (await response.json()) as { success: boolean; data: unknown[] };
  expect(body.success).toBe(true);
  return body.data;
}

test('an educator registers, activates and lands on /setup with account_type educator', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);

  const tenant = loadTenant(CASE);
  expect(tenant.profile, `${CASE} needs the bare (no-org) tenant profile`).toBe('bare');
  const email = `qa+${tenantTag()}-educator@test.local`;

  // --- Steps 1: register the teacher account -------------------------------
  await registerAccount(page, { name: 'Test Nauczyciel', email, option: COPY.optionEducator });

  const context = await userContext(browser);
  try {
    const userPage = await context.newPage();

    // --- Step 3: activate with the mailed link -----------------------------
    await userPage.goto(await confirmationPath(email));
    await expect(userPage).toHaveURL(/\/setup$/, { timeout: 20_000 });

    // The session belongs to the new address and the account is standalone, so
    // `/setup` is the first-run gate, not an empty-list accident.
    const me = (await (await userPage.request.get('/api/v1/auth/me')).json()) as {
      data?: { user?: { email?: string } | null };
    };
    expect(me.data?.user?.email).toBe(email);
    expect(await organizationsOf(userPage), 'a registered educator joins no organization').toEqual(
      [],
    );

    // --- Step 3: log in on the activated account ---------------------------
    const logout = await userPage.request.post('/api/v1/auth/logout');
    expect(logout.ok(), 'POST /api/v1/auth/logout').toBe(true);
    await signIn(userPage, email, /\/setup$/);

    // Expected: the educator token carries account_type=educator, and the
    // first-run chooser is what the login lands on.
    expect(await tokenClaims(context)).toEqual({ email, accountType: 'educator' });
    await expect(userPage.locator('html')).toHaveAttribute('lang', 'pl');
    await expect(userPage.getByRole('heading', { level: 1, name: COPY.setupTitle })).toBeVisible();

    // Adjacent regression: the account type also gates the other dashboard.
    // A manager-only route must bounce the educator back to its onboarding.
    await userPage.goto('/manage');
    await expect(userPage).toHaveURL(/\/setup$/, { timeout: 20_000 });
  } finally {
    await context.close();
  }
});

test('a manager registers, activates and lands on /setup/org with account_type manager', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);

  const tenant = loadTenant(CASE);
  expect(tenant.profile, `${CASE} needs the bare (no-org) tenant profile`).toBe('bare');
  const email = `qa+${tenantTag()}-manager@test.local`;

  // --- Step 2: register the manager account --------------------------------
  await registerAccount(page, { name: 'Test Manager', email, option: COPY.optionManager });

  const context = await userContext(browser);
  try {
    const userPage = await context.newPage();

    // --- Step 3: activate with the mailed link -----------------------------
    await userPage.goto(await confirmationPath(email));
    await expect(userPage).toHaveURL(/\/setup\/org$/, { timeout: 20_000 });

    const me = (await (await userPage.request.get('/api/v1/auth/me')).json()) as {
      data?: { user?: { email?: string } | null };
    };
    expect(me.data?.user?.email).toBe(email);
    expect(
      await organizationsOf(userPage),
      'a registered manager starts with no organization',
    ).toEqual([]);

    // --- Step 3: log in on the activated account ---------------------------
    const logout = await userPage.request.post('/api/v1/auth/logout');
    expect(logout.ok(), 'POST /api/v1/auth/logout').toBe(true);
    await signIn(userPage, email, /\/setup\/org$/);

    // Expected: account_type=manager in the token, and the org setup screen.
    expect(await tokenClaims(context)).toEqual({ email, accountType: 'manager' });
    await expect(userPage.locator('html')).toHaveAttribute('lang', 'pl');
    await expect(userPage.locator('[data-slot="card-title"]')).toHaveText(COPY.setupOrgTitle);

    // Adjacent regression: the manager is kept out of the educator dashboard.
    await userPage.goto('/edu');
    await expect(userPage).toHaveURL(/\/setup\/org$/, { timeout: 20_000 });
  } finally {
    await context.close();
  }
});
