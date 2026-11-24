import { expect, test, type APIResponse, type Page } from '@playwright/test';
import { json } from '#test/helpers/json';
import { loadTenant, loginAs, tenantUser } from '#test/qa/fixtures/tenant';

/**
 * AUT-18 — a manager on the routes of the other roles.
 *
 * Contract (ADR-0015 §7.1 + §14.1): the area URLs are auth-only, so `/app`,
 * `/edu` and `/edu/assignments` load for the manager as they do for anyone
 * signed in — a link is navigation and the API is the boundary. `/setup` is the
 * declared educator exception and still redirects: now to the neutral
 * `/dashboard` landing, which resolves `/manage` from the manager's active org.
 * `/setup/org` remains manager-only and is opened as a real page.
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
 * `/setup/org` is asserted as an actual page, not just as "any 200": the manager
 * must get the organization form with its Polish copy, so a 404/500 or a silent
 * redirect cannot make the route look allowed.
 *
 * Adjacent regression kept deliberately small, because the two `/setup` rules sit
 * next to each other and are easy to invert (`/setup/org` is manager-only, the
 * `/setup` catch-all is educator-only):
 *
 * - an educator must still be bounced from `/setup/org` while still being served
 *   `/setup` itself. Without this, a change that opened `/setup/org` to everyone
 *   would leave the manager assertions above green.
 *
 * Polish copy is asserted because the case quotes the Polish UI; the fixture pins
 * `NEXT_LOCALE=pl` so a locale cookie from another case cannot change the text.
 */

const CASE = 'AUT-18';
const APP_URL = process.env.QA_APP_URL ?? 'http://localhost:3010';

/** Where a manager must land, plus the dashboard marker that proves it rendered. */
const MANAGE = { path: '/manage', title: 'Zarządzanie Uczelnią' } as const;

/** Step 1 — the area routes owned by the other account types. */
const AREA_ROUTES = ['/app', '/edu', '/edu/assignments'] as const;

/** Step 1 — the educator-only onboarding route. */
const EDUCATOR_SETUP = '/setup';

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
  if (!location) throw new Error(`${CASE} redirect carries no Location header`);
  return new URL(location, APP_URL).pathname;
}

/** An area route serves its page to the manager and keeps the URL. */
async function expectAreaLoads(page: Page, path: string): Promise<void> {
  const response = await page.request.get(path, { maxRedirects: 0 });
  expect(response.status(), `GET ${path} must render, not redirect`).toBe(200);
  expect(response.headers()['location'], `${path} must not carry a Location`).toBeUndefined();

  await page.goto(path);
  await expect(page, `browser after GET ${path}`).toHaveURL(new RegExp(`${path}$`));
  await expect(page.locator('[data-slot="sidebar"]')).toHaveCount(1);
}

/** Assert the manager is denied `/setup` and the neutral landing resolves `/manage`. */
async function expectLandingResolvesToManage(page: Page): Promise<void> {
  const response = await page.request.get(EDUCATOR_SETUP, { maxRedirects: 0 });
  expect(response.status(), `GET ${EDUCATOR_SETUP} must redirect, not render`).toBe(307);
  expect(redirectPath(response), `Location of GET ${EDUCATOR_SETUP}`).toBe('/dashboard');

  await page.goto(EDUCATOR_SETUP);
  await expect(page, `browser after GET ${EDUCATOR_SETUP}`).toHaveURL(
    new RegExp(`${MANAGE.path}$`),
    // The landing waits for `/me/orgs` and the active org's permissions.
    { timeout: 15_000 },
  );
  await expect(
    page.locator('[data-slot="breadcrumb-page"]', { hasText: MANAGE.title }),
    'the manager dashboard rendered after the landing',
  ).toBeVisible();
}

test.describe('AUT-18 — a manager on the routes of the other roles', () => {
  test('the area routes load for the manager while /setup resolves to /manage', async ({
    page,
  }) => {
    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} runs on the content tenant profile`).toBe('content');
    expect(tenant.org, 'the content tenant owns its organization').not.toBeNull();

    const manager = tenantUser(tenant, 'manager');

    await loginAs(page, tenant, 'manager', {
      locale: 'pl',
      waitFor: new RegExp(`${MANAGE.path}$`),
    });
    await expect(page).toHaveURL(new RegExp(`${MANAGE.path}$`));

    // The session behind every assertion below is the tenant's own manager: a
    // different account would make the onboarding verdicts below meaningless.
    const me = await page.request.get('/api/v1/auth/me');
    expect(me.ok(), 'GET /api/v1/auth/me').toBe(true);
    const signedIn = (
      await json<{
        data?: {
          user?: { email?: string; app_metadata?: { account_type?: string } } | null;
        };
      }>(me)
    ).data?.user;
    expect(signedIn?.email, 'the session belongs to the tenant manager').toBe(manager.email);
    // Fixture identity (the seeded account is the manager this case says it is),
    // not an authorization input: the area and the onboarding verdicts below are
    // permission-derived.
    expect(signedIn?.app_metadata?.account_type, 'account type of the signed-in user').toBe(
      'manager',
    );

    for (const path of AREA_ROUTES) {
      await expectAreaLoads(page, path);
    }

    await expectLandingResolvesToManage(page);
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

    await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu$/ });

    // The manager-only rule still excludes the educator. The denial target is the
    // neutral landing (never `/manage`), which resolves the educator's own area.
    const denied = await page.request.get(ORG_SETUP.path, { maxRedirects: 0 });
    expect(denied.status(), `GET ${ORG_SETUP.path} as an educator`).toBe(307);
    expect(redirectPath(denied), `Location of GET ${ORG_SETUP.path} as an educator`).toBe(
      '/dashboard',
    );

    await page.goto(ORG_SETUP.path);
    await expect(page).toHaveURL(/\/edu$/, { timeout: 15_000 });

    // ...while the `/setup` catch-all still belongs to the educator, so the
    // manager redirect above is not just "the whole setup area is closed".
    const setup = await page.request.get(EDUCATOR_SETUP, { maxRedirects: 0 });
    expect(setup.status(), 'GET /setup as an educator').toBe(200);
  });
});
