import { expect, test, type APIResponse, type Page } from '@playwright/test';
import { json } from '#test/helpers/json';
import { loadTenant, loginAs, type QaRole } from '#test/qa/fixtures/tenant';

/**
 * AUT-17 — a teacher on the routes of other roles.
 *
 * Contract (ADR-0015 §7.1 + §14.1): the area URLs are auth-only. A signed-in
 * teacher opening `/app`, `/app/flashcards`, `/manage` or `/manage/roles` gets
 * that page — no redirect, no 404 — and the caller's own reads decide what is
 * shown. `/setup/org` is the exception the case also asks about: it is
 * manager-only, so an educator is denied there and lands on the neutral
 * `/dashboard`, which resolves `/edu` from the active org's permissions. `/setup`
 * itself is the educator's route and only leaves it because the teacher is
 * already onboarded.
 *
 * The legacy account (`teacher1@dev.local`, password `pass`) is replaced by the
 * case's own `content` tenant, seeded with a fresh run suffix before every
 * independent run:
 *
 *   bun scripts/qa-tenant.ts AUT-17 --profile content --fresh
 *
 * `content` is what the case needs: one organization whose educator has already
 * onboarded, which is exactly the state the `/setup` parenthetical describes.
 * Every identity is derived from `tenantKey('qa/cases/AUT-17.md',
 * 'AUT-17#<run>', 'qa-shared')` + `tenantId`, and the spec reads only
 * `qa/.tenants/AUT-17.json` — no global admin setting, feature flag, plan row,
 * platform stat, singleton row or another worker's tenant is read or written.
 *
 * Adjacent regressions kept deliberately small, on the same surface:
 *   - the manager direction (`/app`, `/app/flashcards`, `/edu`) loads too, so a
 *     rule that redirected *everyone* would not leave the teacher case green;
 *   - an anonymous visitor gets `307 /login?next=…` for the same paths, which
 *     proves the area pages are still behind auth, not public.
 *
 * Polish copy is asserted because the case quotes the Polish UI; the fixture pins
 * `NEXT_LOCALE=pl` so a locale cookie from another case cannot change it.
 */

const CASE = 'AUT-17';
const APP_URL = process.env.QA_APP_URL ?? 'http://localhost:3010';

/** The dashboard each account type owns, with the breadcrumb marker it renders. */
const DASHBOARDS: Record<'teacher' | 'manager', { path: string; marker: string }> = {
  teacher: { path: '/edu', marker: 'Panel Nauczyciela' },
  manager: { path: '/manage', marker: 'Zarządzanie Uczelnią' },
};

/** The area routes of step 1: they load, they do not redirect. */
const AREA_ROUTES = ['/app', '/app/flashcards', '/manage', '/manage/roles'] as const;

/** The manager-only route of step 1: still a persona exception, still redirected. */
const MANAGER_ROUTE = '/setup/org';

/** Sidebar entries that would prove another role's panel is on screen. */
const FOREIGN_NAV = {
  teacher: ['/app/study/learn', '/manage/members', '/manage/roles'],
  manager: ['/edu/flashcards', '/edu/assignments', '/app/study/learn'],
} as const;

const UI = {
  /** First-run chooser of `/setup` — must never be the teacher's landing state. */
  setupTitle: 'Witaj w StudiQ',
  loginTitle: 'Witaj ponownie',
} as const;

/** Sign in through the product API and keep the session in this page's context. */
async function signIn(page: Page, role: keyof typeof DASHBOARDS): Promise<void> {
  const tenant = loadTenant(CASE);
  const dashboard = DASHBOARDS[role];
  expect(dashboard, `${CASE} has no dashboard for role ${role}`).toBeTruthy();
  expect(tenant.users[role], `tenant ${CASE} has no seeded ${role}`).toBeTruthy();

  await loginAs(page, tenant, role, {
    locale: 'pl',
    waitFor: new RegExp(`${dashboard.path}$`),
  });

  await expect(page).toHaveURL(new RegExp(`${dashboard.path}$`), { timeout: 20_000 });
  await expect(
    page.locator('[data-slot="breadcrumb-page"]', { hasText: dashboard.marker }),
    `${role} starts on its own dashboard`,
  ).toBeVisible();
}

/** The session really belongs to this tenant's user of this account type. */
async function expectTenantSession(page: Page, role: QaRole): Promise<void> {
  const tenant = loadTenant(CASE);
  const me = await page.request.get('/api/v1/auth/me');
  expect(me.ok(), 'GET /api/v1/auth/me').toBe(true);
  const body = await json<{
    data?: { user?: { email?: string; app_metadata?: { account_type?: string } } };
  }>(me);
  expect(body.data?.user?.email, 'the session belongs to the tenant user').toBe(
    tenant.users[role]?.email,
  );
  expect(body.data?.user?.app_metadata?.account_type, 'account type of the session').toBe(
    role === 'teacher' ? 'educator' : 'manager',
  );
}

/** Path a redirect points at, resolved against the app origin. */
function redirectPath(response: APIResponse): string {
  const location = response.headers().location;
  if (!location) throw new Error(`${CASE} redirect carries no Location header`);
  return new URL(location, APP_URL).pathname;
}

/** An area route serves its page to this caller and keeps the URL. */
async function expectAreaLoads(page: Page, path: string): Promise<void> {
  const response = await page.request.get(path, { maxRedirects: 0 });
  expect(response.status(), `GET ${path} must render, not redirect`).toBe(200);

  await page.goto(path);
  await expect(page, `GET ${path} keeps its URL`).toHaveURL(new RegExp(`${path}$`));
  await expect(page.locator('[data-slot="sidebar"]')).toHaveCount(1);
}

/**
 * Assert the proxy denies `/setup/org` to the teacher and the neutral landing
 * then resolves `/edu`; nothing of another role's panel may leak into it.
 */
async function expectLandingResolves(page: Page, role: keyof typeof DASHBOARDS): Promise<void> {
  const destination = DASHBOARDS[role];

  const response = await page.request.get(MANAGER_ROUTE, { maxRedirects: 0 });
  expect(response.status(), `GET ${MANAGER_ROUTE} must redirect, not render`).toBe(307);
  expect(redirectPath(response), `Location of GET ${MANAGER_ROUTE}`).toBe('/dashboard');

  await page.goto(MANAGER_ROUTE);
  await expect(page, `GET ${MANAGER_ROUTE} lands on ${destination.path}`).toHaveURL(
    new RegExp(`${destination.path}$`),
    { timeout: 20_000 },
  );
  await expect(
    page.locator('[data-slot="breadcrumb-page"]', { hasText: destination.marker }),
    `the ${role} dashboard is the one displayed after ${MANAGER_ROUTE}`,
  ).toBeVisible();

  // No other role's navigation may leak into the panel the teacher landed on.
  for (const href of FOREIGN_NAV[role]) {
    await expect(page.locator(`a[href="${href}"]`), `a ${role} must not see ${href}`).toHaveCount(
      0,
    );
  }
  await expect(page.locator('[data-slot="sidebar"]')).toHaveCount(1);
}

test.describe('AUT-17 — a teacher on the routes of other roles', () => {
  test('every area route loads for the teacher and /setup/org sends them to /edu', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} runs on the content tenant profile`).toBe('content');
    expect(tenant.org, 'the content tenant owns its organization').not.toBeNull();
    expect(
      tenant.runSuffix,
      'seed with --fresh: every independent run owns a new tenant',
    ).toBeTruthy();

    await signIn(page, 'teacher');
    await expectTenantSession(page, 'teacher');

    // Step 1: the area URLs are navigation — the page loads for anyone signed in.
    for (const path of AREA_ROUTES) {
      await expectAreaLoads(page, path);
    }

    // The manager-only onboarding route is the persona exception, and a denial
    // lands on the neutral dashboard, which resolves the teacher's own area.
    await expectLandingResolves(page, 'teacher');

    // ...and the teacher can still open its own dashboard afterwards.
    await page.goto('/edu');
    await expect(page).toHaveURL(/\/edu$/);
    await expect(
      page.locator('[data-slot="breadcrumb-page"]', { hasText: DASHBOARDS.teacher.marker }),
    ).toBeVisible();
  });

  test('/setup is allowed for the teacher and returns to /edu when an org already exists', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const tenant = loadTenant(CASE);
    expect(tenant.org, 'the content tenant owns its organization').not.toBeNull();

    await signIn(page, 'teacher');
    await expectTenantSession(page, 'teacher');

    // `/setup/org` is manager-only (asserted above), but `/setup` itself is the
    // educator's route: the proxy answers 200 instead of the 307 the other one
    // gets.
    const setup = await page.request.get('/setup', { maxRedirects: 0 });
    expect(setup.status(), 'GET /setup is allowed for an educator').toBe(200);

    // Why it then leaves `/setup`: the gate sends an already-onboarded caller to
    // the landing, which resolves the area from the org's permissions.
    const orgs = await page.request.get('/api/v1/me/orgs');
    expect(orgs.ok(), 'GET /api/v1/me/orgs').toBe(true);
    const orgList = await json<{ data?: Array<{ id: string; name: string }> }>(orgs);
    expect(orgList.data, 'the teacher belongs to an organization').toHaveLength(1);
    expect(orgList.data?.[0]?.id).toBe(tenant.org!.id);
    expect(orgList.data?.[0]?.name).toBe(tenant.org!.name);

    // The parenthetical of the case: an already-onboarded teacher is sent to the
    // dashboard, not shown the first-run chooser.
    await page.goto('/setup');
    await expect(page).toHaveURL(/\/edu$/, { timeout: 20_000 });
    await expect(
      page.locator('[data-slot="breadcrumb-page"]', { hasText: DASHBOARDS.teacher.marker }),
    ).toBeVisible();
    await expect(
      page.getByText(UI.setupTitle, { exact: true }),
      'the first-run chooser is not shown to a teacher who already has an organization',
    ).toHaveCount(0);
  });
});

test.describe('AUT-17 — adjacent regression paths', () => {
  test('the same area routes load for a manager, whose own dashboard is /manage', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signIn(page, 'manager');
    await expectTenantSession(page, 'manager');

    for (const path of ['/app', '/app/flashcards', '/edu'] as const) {
      await expectAreaLoads(page, path);
    }
  });

  test('an anonymous visitor is sent to /login, not to a dashboard', async ({ page }) => {
    test.setTimeout(120_000);

    for (const path of [...AREA_ROUTES, MANAGER_ROUTE] as const) {
      const response = await page.request.get(path, { maxRedirects: 0 });
      expect(response.status(), `GET ${path} without a session`).toBe(307);
      expect(response.headers().location, `Location of anonymous GET ${path}`).toBe(
        `/login?next=${encodeURIComponent(path)}`,
      );
    }

    // The browser follows the same redirect to the real login form.
    await page.goto('/manage');
    await expect(page).toHaveURL(/\/login\?next=%2Fmanage$/, { timeout: 20_000 });
    await expect(page.getByText(UI.loginTitle, { exact: true })).toBeVisible();
  });
});
