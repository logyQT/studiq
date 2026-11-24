import { expect, type Page } from '@playwright/test';

/**
 * Boot the browser on the account's dashboard after a login.
 *
 * `/login` redirects a signed-in visitor to `/dashboard`, which resolves the
 * area from the active org's permissions and replaces itself — the same path a
 * returning browser takes. The fixture therefore navigates through `/login` and
 * waits for the area the caller expects, instead of computing the area here: a
 * copy of the resolver in a fixture would keep booting specs somewhere the app
 * no longer sends that account.
 *
 * `waitFor` is the spec's own expectation, so a wrong landing still fails the
 * spec at the first assertion rather than silently moving every test.
 */
export async function openDashboard(page: Page, waitFor: RegExp): Promise<void> {
  await page.goto('/login');
  // 15 s is the fixtures' existing arrival budget, kept as-is for the extra hop
  // (document → landing → `/me/orgs` + `/me/permissions` → area).
  await page.waitForURL(waitFor, { timeout: 15_000 });
}

/**
 * The first hop of a returning visit: `/login` names no area, it 307s a
 * signed-in visitor to the neutral landing. Which screen comes next is that
 * landing's answer (an area, or `/setup*` for a settled first run).
 */
export async function expectNeutralLandingRedirect(page: Page): Promise<void> {
  const response = await page.request.get('/login', { maxRedirects: 0 });
  expect(response.status(), 'GET /login').toBe(307);
  const location = response.headers().location;
  expect(location, 'Location of GET /login').toBeTruthy();
  expect(new URL(location!, page.url()).pathname, 'Location of GET /login').toBe('/dashboard');
}
