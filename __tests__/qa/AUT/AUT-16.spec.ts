import { expect, test, type Page, type Response } from '@playwright/test';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

/**
 * AUT-16 — Student → trasy innych ról.
 *
 * The case was written against the legacy manual seed (`student1@dev.local`), but
 * it only needs *a* student session: the account comes from the case's own tenant
 * (`qa/cases/AUT-16.md`):
 *
 *   bun scripts/qa-tenant.ts AUT-16 --profile content --fresh
 *
 * The spec reads `qa/.tenants/AUT-16.json` and never creates accounts itself. Every
 * assertion is a read inside that tenant, so no other worker's tenant and no global
 * row (admin settings, feature flags, plans, singletons) is touched.
 *
 * Acceptance points (case step 1 and expected result): a student opening `/edu`,
 * `/edu/assignments`, `/manage`, `/manage/members`, `/setup` and `/setup/org` lands
 * on `/app`, and the teacher/manager panel content is never displayed — not even
 * for a moment. The redirect is therefore asserted at three levels, because "not
 * even briefly" is a property of *how* the page is delivered, not only of the final
 * URL:
 *
 *   1. the server answers the document request with a redirect, so the panel HTML
 *      is never sent (a 200 + client-side redirect would paint it first);
 *   2. the same gate applies to the RSC request the client router makes on a soft
 *      navigation (otherwise a link click could paint the panel);
 *   3. a mutation observer watches every document for teacher/manager navigation
 *      chrome and must stay empty for the whole navigation.
 *
 * Adjacent regression paths that matter for the tested surface: the gate must stay
 * role-based rather than a blanket block (the tenant's teacher still reaches
 * `/edu/assignments`, its manager still reaches `/manage/members`), and the panel
 * data must be unreachable through the API as well (`403 FORBIDDEN`).
 *
 * No UI copy is asserted — the tenant's teacher/manager pages render in the run
 * locale — so the test only uses URLs, roles and the tenant's own account data.
 */

const CASE = 'AUT-16';
const APP_URL = process.env.QA_APP_URL ?? 'http://localhost:3010';
const STUDENT_HOME = '/app';

/** Step 1 of the case: teacher, manager and onboarding routes. */
const PROTECTED_ROUTES = [
  '/edu',
  '/edu/assignments',
  '/manage',
  '/manage/members',
  '/setup',
  '/setup/org',
] as const;

/** Chrome only a teacher or manager panel renders (locale-independent). */
const PANEL_CHROME = 'a[href="/edu"], a[href^="/edu/"], a[href="/manage"], a[href^="/manage/"]';

/**
 * Remembers every teacher/manager href ever attached to the DOM in the current
 * document, including transient paints that are replaced before the navigation
 * settles. `page.evaluate` after the navigation reads the result.
 */
async function recordForeignPanelChrome(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript((selector: string) => {
    const seen: string[] = [];
    (window as unknown as { __qaPanelChrome?: string[] }).__qaPanelChrome = seen;
    const scan = () => {
      for (const anchor of document.querySelectorAll(selector)) {
        const href = anchor.getAttribute('href') ?? '';
        if (href && !seen.includes(href)) seen.push(href);
      }
    };
    new MutationObserver(scan).observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href'],
    });
    document.addEventListener('DOMContentLoaded', scan);
  }, PANEL_CHROME);

  return () =>
    page.evaluate(
      () => (window as unknown as { __qaPanelChrome?: string[] }).__qaPanelChrome ?? [],
    );
}

/** Path a redirect points at, resolved against the app origin. */
function redirectTarget(response: Response): string {
  const location = response.headers().location;
  expect(location, 'a redirect must carry a Location header').toBeTruthy();
  return new URL(location, APP_URL).pathname;
}

test('a student is redirected from every teacher, manager and onboarding route to /app', async ({
  page,
}) => {
  test.setTimeout(120_000);

  const tenant = loadTenant(CASE);
  const student = tenant.users.student;
  expect(student, `${CASE} needs the tenant's student account`).toBeTruthy();

  const panelChrome = await recordForeignPanelChrome(page);
  await loginAs(page, tenant, 'student');
  expect(new URL(page.url()).pathname, 'the student starts on their own dashboard').toBe(
    STUDENT_HOME,
  );

  const me = await page.request.get('/api/v1/auth/me');
  expect(me.status(), 'GET /api/v1/auth/me').toBe(200);
  expect((await me.json()).data?.user?.email).toBe(student!.email);

  // Every document response of this test, so a protected page served as HTML
  // (200) would stand out from the proxy's redirect (3xx).
  const documents: { path: string; status: number }[] = [];
  page.on('response', (response) => {
    if (response.request().resourceType() !== 'document') return;
    documents.push({ path: new URL(response.url()).pathname, status: response.status() });
  });

  for (const route of PROTECTED_ROUTES) {
    // 1. Server-side gate: a redirect, never the panel document.
    const gate = await page.request.get(route, { maxRedirects: 0 });
    expect(gate.status(), `${route} must answer with a redirect`).toBe(307);
    expect(redirectTarget(gate), `${route} redirect target`).toBe(STUDENT_HOME);

    // 2. Soft navigation: the client router's RSC request is redirected too.
    const routerRequest = await page.request.get(`${route}?_rsc=qa-aut-16`, {
      headers: { RSC: '1' },
      maxRedirects: 0,
    });
    expect(routerRequest.status(), `${route} (RSC) must answer with a redirect`).toBe(307);
    expect(redirectTarget(routerRequest), `${route} (RSC) redirect target`).toBe(STUDENT_HOME);

    // 3. Browser navigation: lands on /app, and the protected path never came
    //    back as an HTML document (no panel to paint, not even for a frame).
    await page.goto(route);
    expect(new URL(page.url()).pathname, `${route} must land on /app`).toBe(STUDENT_HOME);
    await expect(
      page.locator('a[href="/app/flashcards"]').first(),
      `the student dashboard is rendered after ${route}`,
    ).toBeVisible();

    const hops = documents.filter((entry) => entry.path === route).map((entry) => entry.status);
    expect(hops.length, `${route} must be requested as a document`).toBeGreaterThan(0);
    expect(
      hops.every((status) => status >= 300 && status < 400),
      `${route} document must only ever be a redirect, got ${JSON.stringify(hops)}`,
    ).toBe(true);

    expect(await panelChrome(), `${route} must not paint teacher/manager chrome`).toEqual([]);
  }

  // The panel data is gated as well, not only the pages.
  for (const api of [
    '/api/v1/teacher/assignments',
    '/api/v1/organization/members',
    '/api/v1/stats/teacher',
  ]) {
    const response = await page.request.get(api);
    expect(response.status(), `GET ${api} as a student`).toBe(403);
    expect(await response.json()).toMatchObject({ success: false, error: 'FORBIDDEN' });
  }
});

test('the role gate still lets a teacher into the teacher routes', async ({ page }) => {
  test.setTimeout(90_000);

  const tenant = loadTenant(CASE);
  const teacher = tenant.users.teacher;
  expect(teacher, `${CASE} needs the tenant's teacher account`).toBeTruthy();

  await loginAs(page, tenant, 'teacher');

  const gate = await page.request.get('/edu/assignments', { maxRedirects: 0 });
  expect(gate.status(), 'GET /edu/assignments as the teacher').toBe(200);

  await page.goto('/edu/assignments');
  expect(new URL(page.url()).pathname).toBe('/edu/assignments');
  await expect(page.locator('a[href="/edu/questions"]').first()).toBeVisible();

  const me = await page.request.get('/api/v1/auth/me');
  expect((await me.json()).data?.user?.email).toBe(teacher!.email);
});

test('the role gate still lets a manager into the manager routes', async ({ page }) => {
  test.setTimeout(90_000);

  const tenant = loadTenant(CASE);
  const manager = tenant.users.manager;
  const teacher = tenant.users.teacher;
  expect(
    manager && teacher,
    `${CASE} needs the tenant's manager and teacher accounts`,
  ).toBeTruthy();

  await loginAs(page, tenant, 'manager');

  const gate = await page.request.get('/manage/members', { maxRedirects: 0 });
  expect(gate.status(), 'GET /manage/members as the manager').toBe(200);

  await page.goto('/manage/members');
  expect(new URL(page.url()).pathname).toBe('/manage/members');
  await expect(page.locator('a[href="/manage/roles"]').first()).toBeVisible();
  // The manager sees this tenant's own members, not another worker's.
  await expect(page.getByText(teacher!.email).first()).toBeVisible();
});
