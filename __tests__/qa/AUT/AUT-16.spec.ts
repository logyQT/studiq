import { expect, test, type APIResponse, type Page } from '@playwright/test';
import { json } from '#test/helpers/json';
import { loadTenant, loginAs, tenantUser } from '#test/qa/fixtures/tenant';

/**
 * AUT-16 — a student on the routes of other roles.
 *
 * Contract (ADR-0015 §7.1 + §14.1): a link is navigation, the API is the
 * boundary. The three area URLs are **auth-only**, so opening one is not a
 * redirect and not a 404 — the page loads and the caller's own reads decide. What
 * stays closed for a Member is the panel *data*: the roster read is empty or 403
 * (D25) and `/teacher/assignments` is 403 (no `assignment.read` on the Member
 * role). The org-scoped "no access in this org / switch org" card is the second
 * half of the phase and is pinned by its own case.
 *
 * The declared persona exceptions are unchanged and still redirect: `/setup`
 * (EDUCATOR) and `/setup/org` (MANAGER). Since the proxy no longer names an
 * area, their denial target is the neutral `/dashboard` landing, which then
 * resolves `/app` for this student.
 *
 * The case was written against the legacy manual seed (`student1@dev.local`), but
 * it only needs *a* student session: the account comes from the case's own tenant
 * (`qa/cases/AUT-16.md`):
 *
 *   bun scripts/qa-tenant.ts AUT-16 --profile content --fresh
 *
 * Every assertion is a read inside that tenant, so no other worker's tenant and
 * no global row (admin settings, feature flags, plans, singletons) is touched.
 */

const CASE = 'AUT-16';
const APP_URL = process.env.QA_APP_URL ?? 'http://localhost:3010';
const STUDENT_HOME = '/app';

/** Step 1's area routes: the page loads, the data does not. */
const AREA_ROUTES = ['/edu', '/edu/assignments', '/manage', '/manage/members'] as const;

/** Step 1's onboarding routes: the declared persona exceptions, still redirected. */
const ONBOARDING_ROUTES = ['/setup', '/setup/org'] as const;

/** The `Location` a redirect answered with, as the request that follows it. */
function redirectLocation(response: APIResponse): string {
  const location = response.headers().location;
  if (!location) throw new Error(`${CASE} redirect carries no Location header`);
  return location;
}

/** Path a redirect points at, resolved against the app origin. */
function redirectTarget(response: APIResponse): string {
  return new URL(redirectLocation(response), APP_URL).pathname;
}

/** The sidebar is the shell every area page renders; it is what "loaded" means. */
function sidebar(page: Page) {
  return page.locator('[data-slot="sidebar"]');
}

test('a student keeps the URL on every area route and only its own data is served', async ({
  page,
}) => {
  test.setTimeout(120_000);

  const tenant = loadTenant(CASE);
  const student = tenantUser(tenant, 'student');

  await loginAs(page, tenant, 'student');
  expect(new URL(page.url()).pathname, 'the student starts on their own dashboard').toBe(
    STUDENT_HOME,
  );

  const me = await page.request.get('/api/v1/auth/me');
  expect(me.status(), 'GET /api/v1/auth/me').toBe(200);
  expect((await json<{ data?: { user?: { email?: string } | null } }>(me)).data?.user?.email).toBe(
    student.email,
  );

  // Every document response of this test, so a page that answered with a
  // redirect would stand out from the 200 document the contract promises.
  const documents: { path: string; status: number }[] = [];
  page.on('response', (response) => {
    if (response.request().resourceType() !== 'document') return;
    documents.push({ path: new URL(response.url()).pathname, status: response.status() });
  });

  for (const route of AREA_ROUTES) {
    // 1. The route is auth-only: a page, not a redirect (§14.1's bookmarked URL).
    const gate = await page.request.get(route, { maxRedirects: 0 });
    expect(gate.status(), `${route} must load for a member, not redirect`).toBe(200);

    // 2. The RSC fetch the client router makes is not answered by an auth or
    //    persona redirect either. Next canonicalises a bare RSC request with a
    //    `307` to the same path (`?_rsc`, its cache-buster), so what must hold
    //    here is that this framework hop is the *only* one — never `/login` or
    //    `/setup` — and that the canonical URL answers with the page.
    const routerRequest = await page.request.get(`${route}?_rsc=qa-aut-16`, {
      headers: { RSC: '1' },
      maxRedirects: 0,
    });
    const routerStatus = routerRequest.status();
    expect(
      [200, 307],
      `${route} (RSC) must answer the page or Next's canonical RSC redirect, got ${routerStatus}`,
    ).toContain(routerStatus);
    if (routerStatus === 307) {
      expect(redirectTarget(routerRequest), `${route} (RSC) must stay on this route`).toBe(route);
      const canonical = await page.request.get(redirectLocation(routerRequest), {
        headers: { RSC: '1' },
        maxRedirects: 0,
      });
      expect(canonical.status(), `${route} (RSC) canonical URL must answer with the page`).toBe(
        200,
      );
    }

    // 3. The browser keeps the URL and renders the dashboard shell.
    await page.goto(route);
    expect(new URL(page.url()).pathname, `${route} must keep its URL`).toBe(route);
    await expect(sidebar(page), `the shell rendered for ${route}`).toHaveCount(1);

    const hops = documents.filter((entry) => entry.path === route).map((entry) => entry.status);
    expect(hops.length, `${route} must be requested as a document`).toBeGreaterThan(0);
    expect(
      hops.every((status) => status === 200),
      `${route} document must be served, got ${JSON.stringify(hops)}`,
    ).toBe(true);
  }

  // The panel data is gated, not only the pages. The assignment list has no deny
  // shape other than the error: a Member role carries no assignment.read, so it
  // stays 403 (2b-6: the key, not the persona, decides).
  const assignments = await page.request.get('/api/v1/teacher/assignments');
  expect(assignments.status(), 'GET /api/v1/teacher/assignments as a student').toBe(403);
  expect(await assignments.json()).toMatchObject({ success: false, error: 'FORBIDDEN' });

  // The stats read is a content key the Member role holds at `own` (2b-6), so
  // the teacher-stats route answers 200 with the caller's OWN content only —
  // never the teacher's aggregates. 403 stays accepted as an alternative.
  const stats = await page.request.get('/api/v1/stats/teacher');
  expect([403, 200], 'GET /api/v1/stats/teacher as a student').toContain(stats.status());
  if (stats.status() === 403) {
    expect(await stats.json()).toMatchObject({ success: false, error: 'FORBIDDEN' });
  } else {
    const statsBody = await json<{ success: boolean; data?: { totalQuestions?: number } }>(stats);
    expect(statsBody).toMatchObject({ success: true });
    expect(
      statsBody.data?.totalQuestions,
      'own-scope stats: the member owns no questions, so no teacher aggregate can leak',
    ).toBe(0);
    expect(
      JSON.stringify(statsBody),
      'the member stats carry no teacher content (own-scope read)',
    ).not.toContain('teacher');
  }

  // D25: the roster read is a capability a plain Member role lacks, and its
  // deny shape is an empty list. `403` stays accepted as the documented
  // alternative, but a `200` must carry no row — so any member row fails here.
  const members = await page.request.get('/api/v1/organization/members');
  const membersBody = await json<{ success: boolean; data?: unknown[]; error?: string }>(members);
  expect(
    [200, 403],
    `GET /api/v1/organization/members as a student → ${JSON.stringify(membersBody)}`,
  ).toContain(members.status());
  if (members.status() === 403) {
    expect(membersBody).toMatchObject({ success: false, error: 'FORBIDDEN' });
  } else {
    expect(membersBody).toEqual({ success: true, data: [] });
  }
  const membersRaw = JSON.stringify(membersBody);
  expect(membersRaw, 'the roster deny leaks no e-mail').not.toContain('@');
  expect(membersRaw, 'the roster deny leaks the student').not.toContain(student.email);
});

test('a student is still redirected from the onboarding routes to /app', async ({ page }) => {
  test.setTimeout(90_000);

  const tenant = loadTenant(CASE);
  await loginAs(page, tenant, 'student');

  for (const route of ONBOARDING_ROUTES) {
    // `/setup` is educator-only and `/setup/org` manager-only. The proxy answers
    // the neutral landing, which resolves this student's area — never `/edu` or
    // `/manage` by persona (ADR-0015 §7.1).
    const gate = await page.request.get(route, { maxRedirects: 0 });
    expect(gate.status(), `${route} must answer with a redirect`).toBe(307);
    expect(redirectTarget(gate), `${route} redirect target`).toBe('/dashboard');

    await page.goto(route);
    await expect(page, `${route} must land on /app`).toHaveURL(new RegExp(`${STUDENT_HOME}$`), {
      // The landing waits for `/me/orgs` and the active org's permissions.
      timeout: 15_000,
    });
  }
});

test('the auth-only rule still serves a teacher the teacher routes', async ({ page }) => {
  test.setTimeout(90_000);

  const tenant = loadTenant(CASE);
  const teacher = tenantUser(tenant, 'teacher');

  await loginAs(page, tenant, 'teacher');

  const gate = await page.request.get('/edu/assignments', { maxRedirects: 0 });
  expect(gate.status(), 'GET /edu/assignments as the teacher').toBe(200);

  await page.goto('/edu/assignments');
  expect(new URL(page.url()).pathname).toBe('/edu/assignments');
  await expect(page.locator('a[href="/edu/questions"]').first()).toBeVisible();

  const me = await page.request.get('/api/v1/auth/me');
  expect((await json<{ data?: { user?: { email?: string } | null } }>(me)).data?.user?.email).toBe(
    teacher.email,
  );
});

test('the auth-only rule still serves a manager the manager routes', async ({ page }) => {
  test.setTimeout(90_000);

  const tenant = loadTenant(CASE);
  const teacher = tenantUser(tenant, 'teacher');

  await loginAs(page, tenant, 'manager');

  const gate = await page.request.get('/manage/members', { maxRedirects: 0 });
  expect(gate.status(), 'GET /manage/members as the manager').toBe(200);

  await page.goto('/manage/members');
  expect(new URL(page.url()).pathname).toBe('/manage/members');
  await expect(page.locator('a[href="/manage/roles"]').first()).toBeVisible();
  // The manager sees this tenant's own members, not another worker's.
  await expect(page.getByText(teacher.email).first()).toBeVisible();
});
