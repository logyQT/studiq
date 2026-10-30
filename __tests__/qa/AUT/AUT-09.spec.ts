import { expect, test, type Page } from '@playwright/test';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

/**
 * AUT-09 — login honours `?next=` and returns to the requested page.
 *
 * Prerequisite (reconciled with the tenant seeder): no session. The case's
 * account is a student who belongs to an organization — the shape the manual
 * seed's `student1` account had — so the spec runs against the case's own
 * tenant (`bun scripts/qa-tenant.ts AUT-09 --profile content --fresh`, a fresh
 * run suffix per independent run) and reads the student's credentials from
 * `qa/.tenants/AUT-09.json`. No legacy manual account is used and nothing
 * global (settings, feature flags, plans, platform rows) is read or written.
 *
 * Acceptance criteria:
 * 1. a signed-out `GET /app/flashcards` redirects to
 *    `/login?next=%2Fapp%2Fflashcards` — the requested page, encoded, survives;
 * 2. the form login then lands exactly on `/app/flashcards`.
 *
 * Adjacent regressions on the same surface, both confirmed in the walk:
 * - an already-signed-in user opening `/login?next=<page>` still lands on that
 *   page (reload/back after login must not drop the `next` target, #458);
 * - an external `next` target is rejected by the shared validator and the login
 *   falls back to the account dashboard (`/app`), never to another origin.
 *
 * Polish copy is asserted because the case quotes the Polish UI; `NEXT_LOCALE`
 * is pinned so a locale cookie left by another case cannot change it.
 */

const CASE = 'AUT-09';
const APP_URL = process.env.QA_APP_URL ?? 'http://localhost:3010';
const HOST = new URL(APP_URL).hostname;

/** The case's deep link, and the login URL the proxy builds for it. */
const DEEP_LINK = '/app/flashcards';
const LOGIN_WITH_NEXT = `/login?next=${encodeURIComponent(DEEP_LINK)}`;

const COPY = {
  email: 'Adres e-mail',
  password: 'Hasło',
  submit: 'Zaloguj się',
  flashcardsCrumb: 'Fiszki',
  newDeck: 'Nowa talia',
  dashboardGreeting: 'Cześć',
} as const;

/** Path + query of the current page, so assertions are base-URL independent. */
function currentPath(page: Page): string {
  const url = new URL(page.url());
  return `${url.pathname}${url.search}`;
}

/**
 * Open `path` as an anonymous visitor and prove the session really is empty —
 * otherwise the redirect assertions could pass for an already-signed-in user.
 */
async function openAnonymous(page: Page, path: string): Promise<void> {
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'pl', domain: HOST, path: '/' }]);
  const body = (await (await page.request.get('/api/v1/auth/me')).json()) as {
    data?: { user?: unknown };
  };
  expect(body.data?.user ?? null, `${CASE} prerequisite: no session`).toBeNull();
  await page.goto(path);
}

/** The real UI login (the case's step 2), not the API shortcut. */
async function signInThroughForm(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel(COPY.email, { exact: true }).fill(email);
  await page.getByLabel(COPY.password, { exact: true }).fill(password);
  await page.getByRole('button', { name: COPY.submit, exact: true }).click();
}

/** The flashcards page as the student sees it: its breadcrumb and empty deck list. */
async function expectFlashcardsPage(page: Page): Promise<void> {
  await expect(page.getByRole('navigation', { name: 'breadcrumb' })).toContainText(
    COPY.flashcardsCrumb,
  );
  await expect(page.getByRole('button', { name: COPY.newDeck, exact: true }).first()).toBeVisible();
}

test.describe('AUT-09 — login next parameter', () => {
  test('anonymous deep link keeps the page in ?next= and returns to it after login', async ({
    page,
  }) => {
    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    const student = tenant.users.student;
    expect(student, `${CASE} tenant must seed a student`).toBeTruthy();

    await openAnonymous(page, DEEP_LINK);

    // Step 1: the proxy redirects to the login form and keeps the target page.
    expect(currentPath(page), 'signed-out deep link').toBe(LOGIN_WITH_NEXT);
    const loginUrl = new URL(page.url());
    expect(loginUrl.pathname).toBe('/login');
    expect(loginUrl.searchParams.get('next')).toBe(DEEP_LINK);
    await expect(page.getByRole('button', { name: COPY.submit, exact: true })).toBeVisible();

    // Step 2: log in through the form and land exactly on the requested page.
    await signInThroughForm(page, student!.email, student!.password);
    await expect(page).toHaveURL(/\/app\/flashcards$/, { timeout: 15_000 });
    expect(currentPath(page), 'post-login destination').toBe(DEEP_LINK);
    await expectFlashcardsPage(page);

    // The session is the tenant's student, not a leftover from another case.
    const me = (await (await page.request.get('/api/v1/auth/me')).json()) as {
      data?: { user?: { email?: string } | null };
    };
    expect(me.data?.user?.email).toBe(student!.email);
  });

  test('a signed-in user opening /login?next=… still lands on the deep link', async ({ page }) => {
    const tenant = loadTenant(CASE);
    await loginAs(page, tenant, 'student', { locale: 'pl' });
    await expect(page).toHaveURL(/\/app$/);

    await page.goto(LOGIN_WITH_NEXT);

    await expect(page).toHaveURL(/\/app\/flashcards$/, { timeout: 15_000 });
    expect(currentPath(page)).toBe(DEEP_LINK);
    await expectFlashcardsPage(page);
  });

  test('an external next target is ignored and login falls back to the dashboard', async ({
    page,
  }) => {
    const tenant = loadTenant(CASE);
    const student = tenant.users.student;
    expect(student, `${CASE} tenant must seed a student`).toBeTruthy();

    const external = 'https://evil.example/app';
    await openAnonymous(page, `/login?next=${encodeURIComponent(external)}`);
    expect(currentPath(page)).toBe(`/login?next=${encodeURIComponent(external)}`);

    await signInThroughForm(page, student!.email, student!.password);

    // Only the same-origin dashboard is allowed — never the attacker's origin.
    await expect(page).toHaveURL(/\/app$/, { timeout: 15_000 });
    expect(currentPath(page)).toBe('/app');
    expect(new URL(page.url()).origin).toBe(new URL(APP_URL).origin);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(COPY.dashboardGreeting);
  });
});
