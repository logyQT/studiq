import { expect, test, type Page } from '@playwright/test';
import { loadTenant } from '@qa/fixtures/qa-tenant';

/**
 * AUT-14 — Wylogowanie.
 *
 * The case signs in as `student1`, opens the user menu at the bottom of the
 * sidebar, logs out and then presses the browser Back button: the protected
 * student panel must not come back, the anonymous browser is sent to `/login`.
 *
 * The legacy manual account (`student1@dev.local`, password `pass`) is replaced
 * by this case's own tenant, seeded with a fresh run suffix before every
 * independent run:
 *
 *   bun scripts/qa-tenant.ts AUT-14 --profile content --fresh
 *
 * `content` gives the case one organization plus its manager, educator and the
 * student under test, all derived from
 * `tenantKey('qa/cases/AUT-14.md', 'AUT-14#<run>', 'qa-shared')` + `tenantId`.
 * The student signs in through the real login form with the seeded password.
 *
 * The spec reads and writes nothing global — no admin setting, feature flag,
 * plan, platform row or another worker's tenant — and the only row it touches is
 * the session of its own seeded student.
 *
 * Polish copy is asserted because the case quotes the Polish UI; `NEXT_LOCALE=pl`
 * is pinned so a locale cookie left behind by another case cannot change the
 * strings.
 */

const CASE = 'AUT-14';
const HOST = new URL(process.env.QA_APP_URL ?? 'http://localhost:3010').hostname;

const COPY = {
  loginTitle: 'Witaj ponownie',
  emailLabel: 'Adres e-mail',
  passwordLabel: 'Hasło',
  loginButton: 'Zaloguj się',
  logout: 'Wyloguj się',
  greeting: 'Cześć',
} as const;

/** Sidebar footer user menu trigger (bottom of the sidebar). */
const USER_MENU = '[data-sidebar="footer"] button';

/**
 * The case's "logged out" state: the server sees an anonymous caller.
 * `/api/v1/auth/me` answers 200 with `user: null` when anonymous.
 *
 * The cookie jar is deliberately not asserted empty here: the dashboard's
 * in-flight RSC prefetches (`/app/*?_rsc=…`, started before the logout click)
 * can return their redirect *after* the logout response and carry a cookie
 * header that leaves an empty, non-authenticating `sb-…-auth-token` entry
 * behind. That entry cannot authenticate — `/api/v1/auth/me` below is the
 * authoritative check, and the logout response itself must clear the token.
 */
async function expectNoSession(page: Page, context: string): Promise<void> {
  const response = await page.request.get('/api/v1/auth/me');
  expect(response.status(), `${context}: GET /api/v1/auth/me`).toBe(200);
  const body = (await response.json()) as {
    success: boolean;
    data: { user: unknown; session: unknown };
  };
  expect(body.success, `${context}: auth/me success flag`).toBe(true);
  expect(body.data.user, `${context}: no authenticated user`).toBeNull();
  expect(body.data.session, `${context}: no authenticated session`).toBeNull();
}

/** Precondition „Zalogowany jako student1”: the real login form, as a user would. */
async function signInThroughForm(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText(COPY.loginTitle, { exact: true })).toBeVisible();

  await page.getByLabel(COPY.emailLabel, { exact: true }).fill(email);
  await page.getByLabel(COPY.passwordLabel, { exact: true }).fill(password);
  await page.getByRole('button', { name: COPY.loginButton, exact: true }).click();
}

test.describe('AUT-14 — logout', () => {
  test('logout ends the session and browser Back cannot reopen /app', async ({ page }) => {
    test.setTimeout(180_000);

    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} runs on the content tenant profile`).toBe('content');
    expect(tenant.org, 'the content tenant owns its organization').not.toBeNull();
    expect(
      tenant.runSuffix,
      'seed with --fresh: every independent run owns a new tenant',
    ).toBeTruthy();
    const student = tenant.users.student;
    expect(student, `${CASE} seeds the student under test`).toBeTruthy();

    // The case quotes the Polish UI; pin the cookie a returning browser keeps.
    await page
      .context()
      .addCookies([{ name: 'NEXT_LOCALE', value: 'pl', domain: HOST, path: '/' }]);

    // The browser starts signed out, so the Back step below cannot inherit a
    // session from an earlier navigation.
    await expectNoSession(page, 'before login');

    // --- Precondition: sign in as the case's student ----------------------
    await signInThroughForm(page, student!.email, student!.password);
    await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { level: 1 })).toContainText(COPY.greeting);

    const sidebar = page.locator('[data-slot="sidebar"]');
    await expect(sidebar, 'the student dashboard renders one sidebar').toHaveCount(1);

    // --- Step 1: click the avatar/name at the bottom of the sidebar -------
    const userMenu = page.locator(USER_MENU);
    await expect(userMenu, 'user menu at the bottom of the sidebar').toBeVisible();
    await expect(userMenu, 'the trigger shows the signed-in student').toContainText(student!.email);
    await userMenu.click();

    // --- Step 2: choose „Wyloguj się” -------------------------------------
    const logoutItem = page.getByRole('menuitem', { name: COPY.logout, exact: true });
    await expect(logoutItem, 'the user menu offers „Wyloguj się”').toBeVisible();

    const logoutResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/auth/logout',
    );
    await logoutItem.click();
    const logout = await logoutResponse;
    expect(logout.status(), 'POST /api/v1/auth/logout').toBe(200);

    // The route must clear what it owns: the Supabase session cookie (chunked in
    // production as `…-auth-token.0`) and the tenant hint left for the next login
    // (issue #186).
    const clearedCookies = (await logout.headersArray())
      .filter((header) => header.name.toLowerCase() === 'set-cookie')
      .map((header) => header.value);
    expect(
      clearedCookies.some((header) => /^sb-.*-auth-token(?:\.\d+)?=;/.test(header)),
      `logout response clears the session cookie (${JSON.stringify(clearedCookies)})`,
    ).toBe(true);
    expect(
      clearedCookies.some((header) => /^active_org_id=;/.test(header)),
      'logout response drops the active-org hint',
    ).toBe(true);

    // Expected result 1: the browser lands on /login and the session is gone.
    await expect(page).toHaveURL(/\/login(\?|$)/, { timeout: 20_000 });
    await expect(page.getByText(COPY.loginTitle, { exact: true })).toBeVisible();
    await expect(page.locator('[data-sidebar="footer"]'), 'no user menu on /login').toHaveCount(0);
    await expectNoSession(page, 'after logout');

    // --- Step 3: press the browser Back button ----------------------------
    await page.goBack();

    // Expected result 2: the protected panel is not restored from history. The
    // anonymous request for /app is answered with a redirect to /login, which
    // also remembers where the visitor was going.
    await expect(page, 'Back to /app is redirected to /login').toHaveURL(/\/login\?next=%2Fapp$/, {
      timeout: 20_000,
    });
    await expect(page.getByText(COPY.loginTitle, { exact: true })).toBeVisible();
    await expect(
      page.locator('[data-slot="sidebar"]'),
      'no dashboard sidebar after Back',
    ).toHaveCount(0);
    await expect(
      page.locator('h1', { hasText: COPY.greeting }),
      'the student heading is not restored after Back',
    ).toHaveCount(0);
    expect(
      await page.locator('body').innerText(),
      'the signed-out student is nowhere on the restored page',
    ).not.toContain(student!.email);
    await expectNoSession(page, 'after browser Back');

    // Adjacent regression: Back is not a special case — a fresh navigation to a
    // protected page is refused for the same anonymous browser, including a deep
    // link that keeps its path in `?next=`.
    await page.goto('/app');
    await expect(page).toHaveURL(/\/login\?next=%2Fapp$/);
    await page.goto('/app/flashcards');
    await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fflashcards$/);
    await expectNoSession(page, 'after re-entering a protected URL');
  });
});
