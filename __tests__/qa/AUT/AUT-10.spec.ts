import { expect, test, type Page } from '@playwright/test';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

/**
 * AUT-10 — Logowanie: `?next=` nie może przekierować na obcą domenę.
 *
 * The case is a security case with no legacy fixture of its own: its only
 * prerequisite is "no session", and the account it signs in with comes from the
 * case's isolated tenant (`qa/cases/AUT-10.md`, profile `content`):
 *
 *   bun scripts/qa-tenant.ts AUT-10 --profile content --fresh
 *
 * The spec reads `qa/.tenants/AUT-10.json` and never creates accounts itself. It
 * only signs that tenant's student in — every assertion is a read — so no other
 * worker's tenant, and no global row (settings, flags, plans), is touched.
 *
 * Acceptance points (case steps 1 and 2): an absolute external URL and a
 * protocol-relative URL must both be ignored; after login the user stays on this
 * origin and reaches their own dashboard (`/app` for the student).
 *
 * The adjacent regression path that matters here is the other half of the same
 * validation: a *local* deep link must still be honoured after login, and the
 * proxy must apply the same rule to an already signed-in visitor opening
 * `/login?next=…` — otherwise the fix for the open redirect could silently drop
 * every post-login deep link (#458).
 *
 * No UI copy is asserted, so the test does not depend on the locale; the form is
 * driven through its input ids and the submit button.
 */

const CASE = 'AUT-10';
const APP_URL = process.env.QA_APP_URL ?? 'http://localhost:3010';
const APP_ORIGIN = new URL(APP_URL).origin;
const APP_HOST = new URL(APP_URL).hostname;

/** Another origin that must never be reached by the login navigation. */
const EXTERNAL = 'example.com';

/**
 * Any request that leaves the app's own host. A blocked open redirect keeps this
 * empty; a regression shows up as a request to the attacker's host, which is a
 * much more direct signal than the final URL alone.
 */
function trackForeignRequests(page: Page): string[] {
  const foreign: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!/^https?:/i.test(url)) return;
    if (new URL(url).hostname !== APP_HOST) foreign.push(url);
  });
  return foreign;
}

/** Sign in through `/login?next=<next>` exactly as the case's user would. */
async function signInThroughForm(page: Page, next: string, email: string, password: string) {
  await page.goto(`/login?next=${next}`);
  await expect(page).toHaveURL((url) => url.pathname === '/login');

  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);

  const submitted = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/v1/auth/login',
  );
  await page.locator('form button[type="submit"]').click();

  const response = await submitted;
  expect(response.status(), 'POST /api/v1/auth/login').toBe(200);
  expect(await response.json()).toMatchObject({ success: true });
}

/** The session belongs to the tenant user the form was filled with. */
async function expectSignedInAs(page: Page, email: string): Promise<void> {
  const response = await page.request.get('/api/v1/auth/me');
  expect(response.status(), 'GET /api/v1/auth/me').toBe(200);
  const body = (await response.json()) as { data?: { user?: { email?: string } | null } };
  expect(body.data?.user?.email).toBe(email);
}

/** The login landed back on this app, on the student dashboard, with no leftover `next`. */
async function expectOwnDashboard(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });
  expect(new URL(page.url()).origin, 'the app origin is preserved').toBe(APP_ORIGIN);
  expect(page.url()).not.toContain('next=');
  expect(page.url()).not.toContain(EXTERNAL);
}

test('an absolute external ?next is ignored and the user lands on their dashboard', async ({
  page,
}) => {
  test.setTimeout(60_000);

  const tenant = loadTenant(CASE);
  const student = tenant.users.student;
  expect(student, `${CASE} needs the tenant's student account`).toBeTruthy();

  const foreign = trackForeignRequests(page);

  // Step 1 of the case: /login?next=https://example.com
  await signInThroughForm(
    page,
    encodeURIComponent(`https://${EXTERNAL}`),
    student!.email,
    student!.password,
  );

  await expectOwnDashboard(page);
  await expectSignedInAs(page, student!.email);

  expect(foreign, 'no request may leave the app origin').toEqual([]);
});

test('a protocol-relative ?next is ignored and the user lands on their dashboard', async ({
  page,
}) => {
  test.setTimeout(60_000);

  const tenant = loadTenant(CASE);
  const student = tenant.users.student;
  expect(student, `${CASE} needs the tenant's student account`).toBeTruthy();

  const foreign = trackForeignRequests(page);

  // Step 2 of the case: /login?next=//example.com
  await signInThroughForm(page, `//${EXTERNAL}`, student!.email, student!.password);

  await expectOwnDashboard(page);
  await expectSignedInAs(page, student!.email);

  expect(foreign, 'no request may leave the app origin').toEqual([]);
});

test('a local ?next is still honoured after login, and the proxy rejects an external one', async ({
  page,
}) => {
  test.setTimeout(60_000);

  const tenant = loadTenant(CASE);
  const student = tenant.users.student;
  expect(student, `${CASE} needs the tenant's student account`).toBeTruthy();

  await loginAs(page, tenant, 'student');

  const foreign = trackForeignRequests(page);

  // Adjacent regression: blocking external targets must not drop valid deep links.
  await page.goto('/login?next=/app/flashcards');
  await expect(page).toHaveURL(/\/app\/flashcards$/, { timeout: 20_000 });
  expect(new URL(page.url()).origin).toBe(APP_ORIGIN);

  // The same validation guards the proxy path: a signed-in visitor reopening
  // /login with an unsafe target goes to the account dashboard instead.
  await page.goto(`/login?next=//${EXTERNAL}`);
  await expectOwnDashboard(page);

  expect(foreign, 'no request may leave the app origin').toEqual([]);
});
