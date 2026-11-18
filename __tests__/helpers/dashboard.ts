import type { Page } from '@playwright/test';
import { routeRules } from '@studiq/server/config/routes.config';
import { asJson } from '#test/helpers/json';

/**
 * The dashboard the proxy sends a signed-in user to when they open `/login`.
 *
 * Read from `routeRules` rather than copied: if the app's mapping changes, every
 * spec must follow it, and a copy here would keep booting tests somewhere the app
 * no longer redirects to.
 */
export function dashboardFor(accountType: string | undefined): string | undefined {
  if (accountType === undefined) return undefined;

  const rules = routeRules.find((rule) => rule.matcher.test('/login'));
  const byType = rules?.redirectIfAuthenticatedByAccountType;
  if (!byType) return undefined;

  return Object.entries(byType).find(([type]) => type === accountType)?.[1];
}

/**
 * The caller's account type, from the login response's Supabase user.
 *
 * `withAuth` reads the same `app_metadata.account_type`, so a fixture that boots
 * from this lands exactly where the proxy would have sent it.
 */
export function accountTypeFromLogin(body: unknown): string | undefined {
  // `asJson` is a cast, not a check: a body that is not an object (or is null)
  // must fall through to the `/login` fallback, not throw inside a fixture.
  if (typeof body !== 'object' || body === null) return undefined;

  const parsed = asJson<{ user?: { app_metadata?: { account_type?: unknown } } }>(body);
  const accountType = parsed.user?.app_metadata?.account_type;
  return typeof accountType === 'string' ? accountType : undefined;
}

/**
 * Boot the browser on the account's dashboard after a login.
 *
 * The login request already left the session cookie in the context, so `/login`
 * would only redirect here: going there directly saves one document request per
 * test. Both suites pay it per test, and a browser pays roughly double per
 * navigation.
 *
 * An unknown account type falls back to the `/login` redirect — the pre-existing
 * behaviour — so a fixture never guesses a page the account may not be allowed to
 * open.
 */
export async function openDashboard(
  page: Page,
  accountType: string | undefined,
  waitFor: RegExp,
): Promise<void> {
  await page.goto(dashboardFor(accountType) ?? '/login');
  // 15 s is the fixtures' existing arrival budget, kept as-is: this change removes
  // a request, it does not tighten what counts as a slow arrival.
  await page.waitForURL(waitFor, { timeout: 15_000 });
}
