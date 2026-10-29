import { expect, test, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaRole } from '@qa/fixtures/qa-tenant';

/**
 * AUT-17 — Nauczyciel → trasy innych ról (macierz ról).
 *
 * The case signs in as a teacher and opens `/app`, `/app/flashcards`, `/manage`,
 * `/manage/roles` and `/setup/org`; every one of them must send the teacher back
 * to `/edu`. `/setup` is the stated exception — it is allowed for an educator —
 * and the case asks what happens when the teacher already has an organization.
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
 * Route protection does not depend on the tenant shape: the proxy
 * (`apps/web/src/proxy.ts` + `routeRules` in
 * `packages/server/src/config/routes.config.ts`) decides on the JWT
 * `account_type`, so the tenant's seeded educator is enough. The spec is still
 * fully self-contained — it never touches an account it did not seed.
 *
 * Both layers are asserted, because "przekierowanie" has to happen before the
 * page renders:
 *   - the proxy answers `307` + `Location` (no document, no flash of another
 *     role's panel), and
 *   - the browser really lands on the teacher's dashboard.
 *
 * Adjacent regressions kept deliberately small, on the same surface:
 *   - the manager direction of the same matrix (`/app`, `/edu` → `/manage`), so a
 *     rule that admits everyone would not leave the teacher case green;
 *   - an anonymous visitor gets `307 /login?next=…` for the same paths, which
 *     proves the teacher redirect is an authorization decision, not the
 *     signed-out fallback.
 *
 * Polish copy is asserted because the case quotes the Polish UI; the fixture pins
 * `NEXT_LOCALE=pl` so a locale cookie from another case cannot change it.
 */

const CASE = 'AUT-17';

/** The dashboard each account type owns, with the breadcrumb marker it renders. */
const DASHBOARDS: Record<'teacher' | 'manager', { path: string; marker: string }> = {
  teacher: { path: '/edu', marker: 'Panel Nauczyciela' },
  manager: { path: '/manage', marker: 'Zarządzanie Uczelnią' },
};

/** The routes of step 1, verbatim from the case. */
const CASE_ROUTES = ['/app', '/app/flashcards', '/manage', '/manage/roles', '/setup/org'] as const;

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
async function signIn(page: Page, role: QaRole): Promise<void> {
  const tenant = loadTenant(CASE);
  const dashboard = DASHBOARDS[role as keyof typeof DASHBOARDS];
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
  const body = (await me.json()) as {
    data?: { user?: { email?: string; app_metadata?: { account_type?: string } } };
  };
  expect(body.data?.user?.email, 'the session belongs to the tenant user').toBe(
    tenant.users[role]?.email,
  );
  expect(body.data?.user?.app_metadata?.account_type, 'account type of the session').toBe(
    role === 'teacher' ? 'educator' : 'manager',
  );
}

/**
 * Assert the proxy redirects `path` to `destination` before the document renders,
 * then assert the browser really ends on that dashboard and nothing of another
 * role's panel is on screen.
 */
async function expectRoleRedirect(
  page: Page,
  path: string,
  role: keyof typeof DASHBOARDS,
): Promise<void> {
  const destination = DASHBOARDS[role];

  const response = await page.request.get(path, { maxRedirects: 0 });
  expect(response.status(), `GET ${path} must redirect, not render`).toBe(307);
  expect(response.headers().location, `Location of GET ${path}`).toBe(destination.path);

  await page.goto(path);
  await expect(page, `GET ${path} lands on ${destination.path}`).toHaveURL(
    new RegExp(`${destination.path}$`),
    { timeout: 20_000 },
  );
  await expect(
    page.locator('[data-slot="breadcrumb-page"]', { hasText: destination.marker }),
    `the ${role} dashboard is the one displayed after ${path}`,
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
  test('every other-role route redirects the teacher to /edu', async ({ page }) => {
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

    // Step 1: all five routes of the case send an educator to /edu.
    for (const path of CASE_ROUTES) {
      await expectRoleRedirect(page, path, 'teacher');
    }

    // ...and the teacher can still open its own dashboard afterwards.
    await page.goto('/edu');
    await expect(page).toHaveURL(/\/edu$/);
    await expect(
      page.locator('[data-slot="breadcrumb-page"]', { hasText: DASHBOARDS.teacher.marker }),
    ).toBeVisible();
  });

  test('/setup is allowed for the teacher and resolves to /edu when an org already exists', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const tenant = loadTenant(CASE);
    expect(tenant.org, 'the content tenant owns its organization').not.toBeNull();

    await signIn(page, 'teacher');
    await expectTenantSession(page, 'teacher');

    // `/setup/org` is manager-only (it is one of the five routes above), but
    // `/setup` itself is not blocked for an educator: the proxy answers 200
    // instead of the 307 the other routes get.
    const setup = await page.request.get('/setup', { maxRedirects: 0 });
    expect(setup.status(), 'GET /setup is allowed for an educator').toBe(200);

    // Why it then leaves `/setup`: the gate redirects once the org list has
    // settled with a membership, and this teacher is already in its tenant org.
    const orgs = await page.request.get('/api/v1/me/orgs');
    expect(orgs.ok(), 'GET /api/v1/me/orgs').toBe(true);
    const orgList = (await orgs.json()) as { data?: Array<{ id: string; name: string }> };
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
  test('the same matrix sends a manager to /manage, not to /edu', async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, 'manager');
    await expectTenantSession(page, 'manager');

    for (const path of ['/app', '/app/flashcards', '/edu'] as const) {
      await expectRoleRedirect(page, path, 'manager');
    }
  });

  test('an anonymous visitor is sent to /login, not to a dashboard', async ({ page }) => {
    test.setTimeout(120_000);

    for (const path of CASE_ROUTES) {
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
