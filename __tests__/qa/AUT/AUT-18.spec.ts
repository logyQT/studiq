import { expect, test, type APIResponse, type Page } from '@playwright/test';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

/**
 * AUT-18 — a manager on the routes of the other roles.
 *
 * The case opens `/app`, `/edu`, `/edu/assignments` and `/setup` as the manager,
 * expects all four to redirect to `/manage`, then opens `/setup/org`, which the
 * manager is allowed to see.
 *
 * Prerequisite (reconciled with the tenant seeder): the case was written against
 * the legacy manual seed (`manager@dev.local`, `pass`). The suite never signs in
 * as a legacy account; it uses the case's own isolated `content` tenant:
 *
 *   bun scripts/qa-tenant.ts AUT-18 --profile content --fresh
 *
 * `content` gives the case one organization with a manager, an educator and a
 * student, all derived from
 * `tenantKey('qa/cases/AUT-18.md', 'AUT-18#<run>', 'qa-shared')` + `tenantId`.
 * `--fresh` makes every independent run a brand-new tenant, while every id stays
 * deterministic from `qa/.tenants/AUT-18.json` — no hard-coded UUID, no legacy
 * account. The spec reads only its own tenant and writes nothing: no global
 * admin setting, feature flag, plan, platform stat, singleton row or another
 * worker's tenant.
 *
 * The redirect is asserted on the wire as well as in the URL. The matrix lives in
 * `routeRules` (`packages/server/src/config/routes.config.ts`) and is enforced by
 * `apps/web/src/proxy.ts`, which answers a disallowed UI route with `307` +
 * `Location` before the target document renders — that is what "przekierowanie do
 * /manage" means, not a client-side bounce after a flash of the student panel.
 *
 * `/setup/org` is asserted as an actual page, not just as "any 200": the manager
 * must get the organization form with its Polish copy, so a 404/500 or a silent
 * redirect cannot make the route look allowed.
 *
 * Adjacent regression kept deliberately small, because the two `/setup` rules sit
 * next to each other and are easy to invert (`/setup/org` is manager-only, the
 * `/setup` catch-all is educator-only):
 *
 * - an educator must still be bounced from `/setup/org` to `/edu` while still
 *   being served `/setup` itself. Without this, a change that opened `/setup/org`
 *   to everyone would leave the manager assertions above green.
 *
 * Polish copy is asserted because the case quotes the Polish UI; the fixture pins
 * `NEXT_LOCALE=pl` so a locale cookie from another case cannot change the text.
 */

const CASE = 'AUT-18';
const APP_URL = process.env.QA_APP_URL ?? 'http://localhost:3010';

/** Where a manager must land, plus the dashboard marker that proves it rendered. */
const MANAGE = { path: '/manage', title: 'Zarządzanie Uczelnią' } as const;

/** Step 1 — the routes owned by the other account types. */
const OTHER_ROLE_ROUTES = ['/app', '/edu', '/edu/assignments', '/setup'] as const;

/** Step 2 — the manager-only onboarding route. */
const ORG_SETUP = {
  path: '/setup/org',
  title: 'Skonfiguruj swoją organizację',
  description: 'Utwórz organizację, aby rozpocząć.',
  nameLabel: 'Nazwa organizacji',
  submit: 'Utwórz organizację',
} as const;

/**
 * The path a redirect points at. `NextResponse.redirect` may emit an absolute
 * `Location`, so the header is resolved against the app rather than compared as
 * a raw string.
 */
function redirectPath(response: APIResponse): string {
  const location = response.headers()['location'];
  expect(location, 'a redirect must carry a Location header').toBeTruthy();
  return new URL(location, APP_URL).pathname;
}

/** Assert the proxy redirects `path` to `destination` immediately, then follow it. */
async function expectRedirectToManage(page: Page, path: string): Promise<void> {
  const response = await page.request.get(path, { maxRedirects: 0 });
  expect(response.status(), `GET ${path} must redirect, not render`).toBe(307);
  expect(redirectPath(response), `Location of GET ${path}`).toBe(MANAGE.path);

  await page.goto(path);
  await expect(page, `browser after GET ${path}`).toHaveURL(new RegExp(`${MANAGE.path}$`));
  await expect(
    page.locator('[data-slot="breadcrumb-page"]', { hasText: MANAGE.title }),
    'the manager dashboard rendered instead of the requested page',
  ).toBeVisible();
}

test.describe('AUT-18 — a manager on the routes of the other roles', () => {
  test('manager is bounced from /app, /edu, /edu/assignments and /setup to /manage', async ({
    page,
  }) => {
    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} runs on the content tenant profile`).toBe('content');
    expect(tenant.org, 'the content tenant owns its organization').not.toBeNull();

    const manager = tenant.users.manager;
    expect(manager, `${CASE} seeds a manager`).toBeTruthy();

    await loginAs(page, tenant, 'manager', {
      locale: 'pl',
      waitFor: new RegExp(`${MANAGE.path}$`),
    });
    await expect(page).toHaveURL(new RegExp(`${MANAGE.path}$`));

    // The session behind every redirect below is the tenant's own manager: a
    // different account type would make all four routes legitimately reachable.
    const me = await page.request.get('/api/v1/auth/me');
    expect(me.ok(), 'GET /api/v1/auth/me').toBe(true);
    const signedIn = (
      (await me.json()) as {
        data?: {
          user?: { email?: string; app_metadata?: { account_type?: string } } | null;
        };
      }
    ).data?.user;
    expect(signedIn?.email, 'the session belongs to the tenant manager').toBe(manager!.email);
    expect(signedIn?.app_metadata?.account_type, 'account type of the signed-in user').toBe(
      'manager',
    );

    for (const path of OTHER_ROLE_ROUTES) {
      await expectRedirectToManage(page, path);
    }
  });

  test('manager may open /setup/org and gets the organization form', async ({ page }) => {
    const tenant = loadTenant(CASE);
    await loginAs(page, tenant, 'manager', {
      locale: 'pl',
      waitFor: new RegExp(`${MANAGE.path}$`),
    });

    // Step 2: the manager-only route is served, not redirected away.
    const response = await page.request.get(ORG_SETUP.path, { maxRedirects: 0 });
    expect(response.status(), `GET ${ORG_SETUP.path} must be allowed`).toBe(200);
    expect(
      response.headers()['location'],
      `${ORG_SETUP.path} must not redirect for a manager`,
    ).toBeUndefined();

    await page.goto(ORG_SETUP.path);
    await expect(page).toHaveURL(/\/setup\/org$/);
    await expect(page.getByText(ORG_SETUP.title, { exact: true })).toBeVisible();
    await expect(page.getByText(ORG_SETUP.description, { exact: true })).toBeVisible();
    await expect(page.getByLabel(ORG_SETUP.nameLabel)).toBeVisible();
    // The form is real: the submit control exists (it stays disabled until a name
    // is typed, so only its presence is pinned — the spec never creates an org).
    await expect(page.getByRole('button', { name: ORG_SETUP.submit })).toBeVisible();
  });

  test('an educator is still bounced from /setup/org while /setup stays open', async ({ page }) => {
    const tenant = loadTenant(CASE);
    const teacher = tenant.users.teacher;
    expect(teacher, `${CASE} seeds an educator`).toBeTruthy();

    await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu$/ });

    // The manager-only rule still excludes the educator: the redirect target is
    // the educator dashboard, not `/manage`.
    const denied = await page.request.get(ORG_SETUP.path, { maxRedirects: 0 });
    expect(denied.status(), `GET ${ORG_SETUP.path} as an educator`).toBe(307);
    expect(redirectPath(denied), `Location of GET ${ORG_SETUP.path} as an educator`).toBe('/edu');

    await page.goto(ORG_SETUP.path);
    await expect(page).toHaveURL(/\/edu$/);

    // ...while the `/setup` catch-all still belongs to the educator, so the
    // manager redirect above is not just "the whole setup area is closed".
    const setup = await page.request.get('/setup', { maxRedirects: 0 });
    expect(setup.status(), 'GET /setup as an educator').toBe(200);
  });
});
