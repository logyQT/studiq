import { expect, test, type Page } from '@playwright/test';
import { loadTenant } from '@qa/fixtures/qa-tenant';

/**
 * AUT-15 — anonymous visitor on the protected routes.
 *
 * Prerequisite (verbatim): „Brak sesji.” The case opens each dashboard route
 * without a session; every one of them must redirect to the login page and keep
 * the requested path in `?next=` so the user can return there after signing in.
 *
 * Tenant: `bun scripts/qa-tenant.ts AUT-15 --profile content --fresh`
 * (`tenantKey('qa/cases/AUT-15.md', 'AUT-15#<run>', 'qa-shared')` → deterministic
 * org/user UUIDs, a fresh run suffix per independent run). The tenant is seeded
 * for the usual per-case isolation, but this case is defined by the *absence* of
 * a session, so none of its users is ever signed in: the spec only proves that a
 * real seeded account exists and that the browser context still holds no session
 * before it walks the routes. No legacy `@dev.local` account, no global admin
 * setting, feature flag, plan or singleton row is read or written.
 *
 * Acceptance criteria:
 * 1. each of the eight routes redirects to `/login?next=<path>`;
 * 2. the redirect happens on the wire (`3xx` + `Location`), not as a client-side
 *    bounce after the protected page renders;
 * 3. the browser really lands on the login form, with the requested path decoded
 *    back into the `next` parameter.
 *
 * Adjacent regression kept deliberately small: the public surfaces (landing,
 * pricing, login, register) must stay reachable without a session. A guard that
 * redirected everyone would make the eight assertions above look green while
 * locking anonymous visitors out of the product entirely.
 *
 * Polish copy is asserted because the case quotes the Polish UI; the context
 * pins `NEXT_LOCALE=pl` so a locale cookie from another case cannot change it.
 */

const CASE = 'AUT-15';
const APP_URL = process.env.QA_APP_URL ?? 'http://localhost:3010';
const HOST = new URL(APP_URL).hostname;

/** Step 1, in the case's order. */
const PROTECTED_ROUTES = [
  '/app',
  '/edu',
  '/manage',
  '/setup',
  '/setup/org',
  '/app/flashcards',
  '/edu/assignments',
  '/manage/members',
] as const;

/** Public pages that must never require a session. */
const PUBLIC_ROUTES = ['/', '/pricing', '/login', '/register'] as const;

const COPY = {
  loginTitle: 'Witaj ponownie',
  loginSubtitle: 'Zaloguj się, aby kontynuować naukę',
  loginSubmit: 'Zaloguj się',
  pricingTitle: 'Wybierz Swój Plan',
} as const;

/** Path + query of the current page, so assertions are base-URL independent. */
function currentPath(page: Page): string {
  const url = new URL(page.url());
  return `${url.pathname}${url.search}`;
}

/** The login URL the proxy builds for a protected route. */
function loginUrlFor(path: string): string {
  return `/login?next=${encodeURIComponent(path)}`;
}

/**
 * Pin the locale and prove the session really is empty — otherwise a redirect
 * assertion could pass for an already-signed-in user, which is the opposite case
 * (AUT-11 / AUT-16–18).
 */
async function expectAnonymous(page: Page): Promise<void> {
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'pl', domain: HOST, path: '/' }]);
  const body = (await (await page.request.get('/api/v1/auth/me')).json()) as {
    data?: { user?: unknown };
  };
  expect(body.data?.user ?? null, `${CASE} prerequisite: no session`).toBeNull();
}

test.describe('AUT-15 — anonymous visitor on protected routes', () => {
  test('each protected route redirects to /login?next=<path>', async ({ page }) => {
    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    expect(tenant.runSuffix, 'seed with --fresh so every run owns a new tenant').toBeTruthy();
    // A real seeded account exists; the case is that it is *not* signed in.
    expect(tenant.users.student?.email, `${CASE} tenant must seed a student`).toBeTruthy();

    await expectAnonymous(page);

    for (const path of PROTECTED_ROUTES) {
      // On the wire: the proxy answers before the protected document renders.
      const response = await page.request.get(path, { maxRedirects: 0 });
      expect(response.status(), `GET ${path} must redirect, not render`).toBeGreaterThanOrEqual(
        300,
      );
      expect(response.status(), `GET ${path} must redirect, not render`).toBeLessThan(400);

      const location = response.headers().location;
      expect(location, `Location header for GET ${path}`).toBeTruthy();
      const target = new URL(location!, APP_URL);
      expect(target.origin, `GET ${path} must stay on this origin`).toBe(new URL(APP_URL).origin);
      expect(target.pathname, `GET ${path} must target the login page`).toBe('/login');
      expect(target.searchParams.get('next'), `?next= of GET ${path}`).toBe(path);

      // In the browser: the visitor really ends on the login form.
      const documentResponse = await page.goto(path);
      expect(documentResponse?.status(), `document for ${path}`).toBe(200);
      await expect(page).toHaveURL(
        (url) => url.pathname === '/login' && url.searchParams.get('next') === path,
        { timeout: 15_000 },
      );
      expect(currentPath(page), `landing page for ${path}`).toBe(loginUrlFor(path));

      await expect(page.getByText(COPY.loginTitle, { exact: true })).toBeVisible();
      await expect(page.getByText(COPY.loginSubtitle, { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: COPY.loginSubmit, exact: true })).toBeVisible();
    }
  });

  test('public pages stay reachable without a session', async ({ page }) => {
    await expectAnonymous(page);

    for (const path of PUBLIC_ROUTES) {
      const response = await page.request.get(path, { maxRedirects: 0 });
      expect(response.status(), `GET ${path} for an anonymous visitor`).toBe(200);
    }

    // The two marketing pages render their own content instead of the login card.
    await page.goto('/pricing');
    expect(currentPath(page), 'pricing must not redirect').toBe('/pricing');
    await expect(
      page.getByRole('heading', { level: 1, name: COPY.pricingTitle, exact: true }),
    ).toBeVisible();

    await page.goto('/');
    expect(currentPath(page), 'landing must not redirect').toBe('/');
  });
});
