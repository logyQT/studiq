import { expect, test, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaRole } from '@qa/fixtures/qa-tenant';

/**
 * AUT-11 — Zalogowany użytkownik na /login i /register.
 *
 * The case signs in as a teacher and opens both auth pages; each one must bounce
 * straight to the dashboard of the account type. The suite tenant is the case's
 * own, isolated one (`qa/cases/AUT-11.md`, profile `content`):
 *
 *   bun scripts/qa-tenant.ts AUT-11 --profile content --fresh
 *
 * `content` is what the case needs: one organization with an educator, a manager
 * and a student, so the account-type redirect can be checked for all three
 * branches without touching another worker's tenant. `--fresh` gives every
 * independent run its own run suffix (and therefore its own deterministic
 * `tenantKey`/`tenantId`s), while the spec itself derives every identity from
 * `qa/.tenants/AUT-11.json`.
 *
 * The redirect is asserted on the wire as well as in the URL: the proxy answers
 * `/login` and `/register` with a `307` and a `Location` header *before* the page
 * renders (`NextResponse.redirect` in `apps/web/src/proxy.ts`), which is what
 * "przekierowują natychmiast" means — not a client-side bounce after a flash of
 * the login form.
 *
 * Adjacent regression kept deliberately small: an anonymous visitor must still
 * get the real `/login` and `/register` forms. Otherwise a redirect that fired
 * for everyone would make the two panels above look green while locking every
 * signed-out user out of authentication.
 *
 * Polish copy is asserted because the case quotes the Polish UI; the fixture pins
 * `NEXT_LOCALE=pl` so a locale cookie from another case cannot change it.
 */

const CASE = 'AUT-11';

/** The dashboard each account type must land on, with a marker unique to it. */
const DASHBOARDS: Record<'teacher' | 'manager' | 'student', { path: string; marker: string }> = {
  teacher: { path: '/edu', marker: 'Panel Nauczyciela' },
  manager: { path: '/manage', marker: 'Zarządzanie Uczelnią' },
  student: { path: '/app', marker: 'Moja Nauka' },
};

const FORM = {
  login: { title: 'Witaj ponownie', subtitle: 'Zaloguj się, aby kontynuować naukę' },
  register: { title: 'Utwórz konto', subtitle: 'Dołącz do StudiQ i rozpocznij naukę' },
} as const;

/**
 * Assert the proxy redirects `path` to `destination` immediately (307 before the
 * document renders), then assert the browser really ends on the dashboard.
 */
async function expectImmediateRedirect(
  page: Page,
  path: string,
  destination: { path: string; marker: string },
): Promise<void> {
  const response = await page.request.get(path, { maxRedirects: 0 });
  expect(response.status(), `GET ${path} must redirect, not render`).toBe(307);
  expect(response.headers().location, `Location of GET ${path}`).toBe(destination.path);

  await page.goto(path);
  await expect(page).toHaveURL(new RegExp(`${destination.path}$`));
  await expect(page.locator('body')).toContainText(destination.marker);
}

/** Sign in through the product API and keep the session in this page's context. */
async function signIn(page: Page, role: QaRole): Promise<void> {
  const tenant = loadTenant(CASE);
  const dashboard = DASHBOARDS[role as keyof typeof DASHBOARDS];
  expect(dashboard, `${CASE} has no dashboard for role ${role}`).toBeTruthy();
  expect(tenant.users[role], `tenant ${CASE} has no seeded ${role}`).toBeTruthy();

  await loginAs(page, tenant, role, {
    locale: 'pl',
    waitFor: new RegExp(`${dashboard.path}$`),
  });

  // The fixture already opened `/login`; that navigation is step 1 of the case.
  await expect(page).toHaveURL(new RegExp(`${dashboard.path}$`));
  await expect(page.locator('body')).toContainText(dashboard.marker);
}

test.describe('AUT-11 — a signed-in user on /login and /register', () => {
  test('teacher (educator) is redirected from both auth pages to /edu', async ({ page }) => {
    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    expect(tenant.runSuffix, 'seed with --fresh so every run owns a new tenant').toBeTruthy();

    await signIn(page, 'teacher');

    // The session behind the redirect is the tenant's own educator.
    const me = await page.request.get('/api/v1/auth/me');
    expect(me.ok(), 'GET /api/v1/auth/me').toBe(true);
    const body = (await me.json()) as {
      data?: { user?: { email?: string; app_metadata?: { account_type?: string } } };
    };
    expect(body.data?.user?.email).toBe(tenant.users.teacher?.email);
    expect(body.data?.user?.app_metadata?.account_type).toBe('educator');

    // Step 2 — the register page redirects exactly like the login page.
    await expectImmediateRedirect(page, '/register', DASHBOARDS.teacher);

    // Step 1 again, this time through a cold navigation after the register bounce.
    await expectImmediateRedirect(page, '/login', DASHBOARDS.teacher);
  });

  test('manager is redirected from both auth pages to /manage', async ({ page }) => {
    await signIn(page, 'manager');
    await expectImmediateRedirect(page, '/login', DASHBOARDS.manager);
    await expectImmediateRedirect(page, '/register', DASHBOARDS.manager);
  });

  test('student is redirected from both auth pages to /app', async ({ page }) => {
    await signIn(page, 'student');
    await expectImmediateRedirect(page, '/login', DASHBOARDS.student);
    await expectImmediateRedirect(page, '/register', DASHBOARDS.student);
  });

  test('an anonymous visitor still gets the /login and /register forms', async ({ page }) => {
    // No session: both pages must answer 200 and render their own form, which is
    // the regression the redirect above could break for everyone.
    for (const path of ['/login', '/register'] as const) {
      const response = await page.request.get(path, { maxRedirects: 0 });
      expect(response.status(), `GET ${path} for an anonymous visitor`).toBe(200);
    }

    await page.goto('/login');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText(FORM.login.title, { exact: true })).toBeVisible();
    await expect(page.getByText(FORM.login.subtitle, { exact: true })).toBeVisible();

    await page.goto('/register');
    await expect(page).toHaveURL(/\/register$/);
    await expect(page.getByText(FORM.register.title, { exact: true })).toBeVisible();
    await expect(page.getByText(FORM.register.subtitle, { exact: true })).toBeVisible();
  });
});
