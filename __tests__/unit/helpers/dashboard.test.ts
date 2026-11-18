import { describe, expect, it } from 'vitest';
import { routeRules } from '@studiq/server/config/routes.config';
import { accountTypeFromLogin, dashboardFor } from '#test/helpers/dashboard';

/**
 * The fixtures boot straight to a dashboard instead of letting `/login` redirect.
 * That is only correct while the map here agrees with the proxy's route rules, so
 * these assertions are about the app's behaviour, not about the helper's shape.
 */
describe('dashboardFor', () => {
  it('matches the proxy rule for every account type', () => {
    const rule = routeRules.find((candidate) => candidate.matcher.test('/login'));
    const routes = rule?.redirectIfAuthenticatedByAccountType;

    // Not a tautology: it fails if the proxy stops redirecting `/login` at all,
    // which is the thing that made `/login` a valid boot path to begin with.
    expect(routes).toBeDefined();
    expect(dashboardFor('manager')).toBe(routes?.manager);
    expect(dashboardFor('educator')).toBe(routes?.educator);
    expect(dashboardFor('student')).toBe(routes?.student);
  });

  it('resolves each type to its own dashboard', () => {
    expect([dashboardFor('manager'), dashboardFor('educator'), dashboardFor('student')]).toEqual([
      '/manage',
      '/edu',
      '/app',
    ]);
  });

  it('returns nothing for an unknown or absent type, so the caller can fall back', () => {
    // The fallback is `/login`, i.e. exactly what the fixtures did before; a guess
    // here would boot a spec on a page the account may not be allowed to open.
    expect(dashboardFor(undefined)).toBeUndefined();
    expect(dashboardFor('superuser')).toBeUndefined();
    expect(dashboardFor('MANAGER')).toBeUndefined();
  });
});

describe('accountTypeFromLogin', () => {
  it('reads the type from the Supabase user the login endpoint returns', () => {
    expect(accountTypeFromLogin({ user: { app_metadata: { account_type: 'educator' } } })).toBe(
      'educator',
    );
  });

  it('returns nothing rather than throwing when the response has no user', () => {
    expect(accountTypeFromLogin({})).toBeUndefined();
    expect(accountTypeFromLogin({ user: {} })).toBeUndefined();
    expect(accountTypeFromLogin({ user: { app_metadata: { account_type: 3 } } })).toBeUndefined();
    expect(accountTypeFromLogin(null)).toBeUndefined();
  });
});
