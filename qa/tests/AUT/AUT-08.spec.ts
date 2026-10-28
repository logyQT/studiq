import { expect, test, type Page } from '@playwright/test';
import { shortHash } from '#test/e2e/fixtures/ids';
import { loadTenant } from '@qa/fixtures/qa-tenant';

/**
 * AUT-08 — Logowanie: niepoprawne dane.
 *
 * Prerequisite „Brak sesji”: every test opens `/login` in a fresh browser context,
 * so there is never a session to clear. The case tenant
 * (`tenantKey('qa/cases/AUT-08.md', 'AUT-08', 'qa-shared')`, seeded with
 * `bun scripts/qa-tenant.ts AUT-08 --fresh`) supplies the one account the case
 * needs: its `student` user. The case's legacy `student1@dev.local` maps onto that
 * user; `nobody@dev.local` maps onto a deterministic per-run address derived from
 * the tenant key, so an unknown account can never collide with a seeded one or with
 * another worker's tenant.
 *
 * What the walk confirmed on the shared app (Polish UI, `NEXT_LOCALE=pl` pinned):
 *
 * - A wrong password and an unknown address are indistinguishable: the same toast
 *   „Nieprawidłowy adres e-mail lub hasło.” and the same `401 UNAUTHORIZED` body.
 * - An empty form is rejected client-side with the two inline required messages and
 *   never calls the API.
 * - A malformed address reports the format error and never calls the API.
 * - The same account logs in when the address is typed in upper case.
 *
 * Nothing global (admin setting, feature flag, plan, platform stat, singleton row)
 * is read or written, and no other tenant's data is touched.
 */

const CASE = 'AUT-08';

const COPY = {
  header: 'Witaj ponownie',
  submit: 'Zaloguj się',
  invalidCredentials: 'Nieprawidłowy adres e-mail lub hasło.',
  emailRequired: 'Adres e-mail jest wymagany.',
  passwordRequired: 'Hasło jest wymagane.',
  emailInvalid: 'Wprowadź poprawny adres e-mail.',
} as const;

/** Step 1 of the case: an existing account with the wrong password. */
const INVALID_PASSWORD = 'zlehaslo';
/** Step 2: any password for an account that does not exist. */
const GHOST_PASSWORD = 'NieMaMnie1';

const LOGIN_PATH = '/api/v1/auth/login';

/** The case's own seeded student — never the legacy `student1@dev.local`. */
function student(): { id: string; email: string; password: string } {
  const user = loadTenant(CASE).users.student;
  if (!user) throw new Error(`tenant ${CASE} has no seeded student user`);
  return user;
}

/** A per-run address that no seeded account or other worker can own. */
function unknownEmail(): string {
  return `qa+${shortHash(loadTenant(CASE).key)}+ghost@test.local`;
}

/** Open the public login form in Polish, with no session. */
async function openLogin(page: Page): Promise<void> {
  const host = new URL(test.info().project.use.baseURL ?? 'http://localhost:3010').hostname;
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'pl', domain: host, path: '/' }]);
  await page.goto('/login');
  await expect(page.locator('[data-slot="card-title"]')).toHaveText(COPY.header);
}

function loginButton(page: Page) {
  return page.getByRole('button', { name: COPY.submit });
}

/** The message `FormMessage` renders under one field (validation, not a toast). */
function fieldMessage(page: Page, field: 'email' | 'password') {
  return page
    .locator('[data-slot="form-item"]')
    .filter({ has: page.locator(`#${field}`) })
    .locator('[data-slot="form-message"]');
}

/** Error toasts live in Sonner's polite region. */
function errorToasts(page: Page) {
  return page.locator('[data-sonner-toast][data-type="error"]');
}

async function fillCredentials(page: Page, email: string, password: string): Promise<void> {
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
}

/** Submit and read the API answer the form receives (status + parsed body). */
async function submitAndReadResponse(page: Page): Promise<{ status: number; body: unknown }> {
  const pending = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === LOGIN_PATH,
    { timeout: 15_000 },
  );
  await loginButton(page).click();
  const response = await pending;
  return { status: response.status(), body: (await response.json()) as unknown };
}

/** Caller-visible session state; `/auth/me` answers with `user: null` when signed out. */
async function sessionUser(page: Page): Promise<{ email?: string } | null> {
  const response = await page.request.get('/api/v1/auth/me');
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { data?: { user?: { email?: string } | null } };
  return body.data?.user ?? null;
}

/** Supabase's SSR auth cookie (`sb-<ref>-auth-token`, possibly chunked). */
async function authCookieNames(page: Page): Promise<string[]> {
  const cookies = await page.context().cookies();
  return cookies.filter((cookie) => /-auth-token/.test(cookie.name)).map((cookie) => cookie.name);
}

/** Records any call to the login endpoint so a "no request" assertion is meaningful. */
function trackLoginRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === LOGIN_PATH) requests.push(request.url());
  });
  return requests;
}

test('answers a wrong password and an unknown account with the same message', async ({ page }) => {
  const user = student();
  await openLogin(page);

  // Step 1: the seeded student's real address, the wrong password.
  await fillCredentials(page, user.email, INVALID_PASSWORD);
  const wrongPassword = await submitAndReadResponse(page);

  await expect(errorToasts(page)).toHaveText(COPY.invalidCredentials);
  await expect(page).toHaveURL(/\/login$/);
  expect(await sessionUser(page), 'a failed login creates no session').toBeNull();
  expect(await authCookieNames(page), 'a failed login sets no auth cookie').toEqual([]);

  // Step 2: an address that belongs to nobody. A reload clears the first toast, so
  // the second message is read on its own rather than next to the first one.
  await page.reload();
  await expect(page.locator('[data-slot="card-title"]')).toHaveText(COPY.header);

  await fillCredentials(page, unknownEmail(), GHOST_PASSWORD);
  const unknownAccount = await submitAndReadResponse(page);

  await expect(errorToasts(page)).toHaveText(COPY.invalidCredentials);
  await expect(page).toHaveURL(/\/login$/);
  expect(await sessionUser(page), 'an unknown account creates no session').toBeNull();
  expect(await authCookieNames(page), 'an unknown account sets no auth cookie').toEqual([]);

  // The whole answer — UI text and API payload — must not reveal which account exists.
  expect(unknownAccount).toEqual(wrongPassword);
  expect(wrongPassword).toEqual({
    status: 401,
    body: { success: false, error: 'UNAUTHORIZED' },
  });
});

test('requires both fields and never calls the login API', async ({ page }) => {
  await openLogin(page);
  const loginRequests = trackLoginRequests(page);

  // Step 3: submit the empty form.
  await loginButton(page).click();

  await expect(fieldMessage(page, 'email')).toHaveText(COPY.emailRequired);
  await expect(fieldMessage(page, 'password')).toHaveText(COPY.passwordRequired);
  await expect(page).toHaveURL(/\/login$/);

  // Validation is synchronous; give any (unexpected) request a beat to surface.
  await page.waitForTimeout(250);
  expect(loginRequests, 'an empty form is rejected before the API').toEqual([]);
  expect(await sessionUser(page)).toBeNull();
  expect(await authCookieNames(page)).toEqual([]);
});

test('reports a malformed address without calling the login API', async ({ page }) => {
  await openLogin(page);
  const loginRequests = trackLoginRequests(page);

  // Adjacent path: the format gate must fire before credentials are checked, or an
  // invalid address would get the credentials message and hide the real mistake.
  await fillCredentials(page, 'not-an-email', GHOST_PASSWORD);
  await loginButton(page).click();

  await expect(fieldMessage(page, 'email')).toHaveText(COPY.emailInvalid);
  await expect(fieldMessage(page, 'password')).toHaveCount(0);
  await expect(page).toHaveURL(/\/login$/);

  await page.waitForTimeout(250);
  expect(loginRequests, 'a malformed address is rejected before the API').toEqual([]);
});

test('logs in the same account when the e-mail is typed in upper case', async ({ page }) => {
  const user = student();
  await openLogin(page);

  // Step 4: STUDENT1@DEV.LOCAL / pass against the tenant's student.
  await fillCredentials(page, user.email.toUpperCase(), user.password);
  const login = await submitAndReadResponse(page);

  expect(login.status).toBe(200);
  expect(login.body).toMatchObject({ success: true });

  // A student lands on the student dashboard; the login form is gone.
  await expect(page).toHaveURL(/\/app(\/|$)/, { timeout: 20_000 });
  await expect(errorToasts(page)).toHaveCount(0);
  await expect(page.locator('#email'), 'the login form is left behind').toHaveCount(0);

  // The session exists and belongs to the same (lower-case) account.
  expect(await authCookieNames(page)).not.toEqual([]);
  const signedIn = await sessionUser(page);
  expect(signedIn?.email).toBe(user.email.toLowerCase());
});
