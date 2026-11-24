/**
 * Audit: trailing-slash consistency of the UI route rules.
 *
 * `apps/web/src/proxy.ts` returns for every `/api/*` request before consulting
 * `routeRules`, so the rules only describe UI paths; the API surface is audited
 * by `api-auth-inventory.test.ts`.
 *
 * Verifies that routeRules patterns match both the plain and the trailing-slash
 * form of the auth and dashboard routes. `/setup/*` ordering is covered by
 * `setup-org-trailing-slash-audit.test.ts`.
 */

import { routeRules } from '@studiq/server/config/routes.config';
import { describe, expect, it } from 'vitest';

// Helper: extract the rule that matches a given path (order matters!)
function matchRule(path: string) {
  return routeRules.find((rule) => rule.matcher.test(path)) ?? null;
}

// Helper: test that two paths resolve to the SAME rule
function assertSameRule(a: string, b: string) {
  const ruleA = matchRule(a);
  const ruleB = matchRule(b);
  expect(ruleA).not.toBeNull();
  expect(ruleB).not.toBeNull();
  expect(ruleA?.matcher.source).toBe(ruleB?.matcher.source);
}

describe('routeRules — trailing slash consistency', () => {
  // --- UI routes ---
  describe('UI dashboard routes', () => {
    it('matches /manage and /manage/ to same rule', () => {
      assertSameRule('/manage', '/manage/');
    });

    it('matches /edu and /edu/ to same rule', () => {
      assertSameRule('/edu', '/edu/');
    });

    it('matches /app and /app/ to same rule', () => {
      assertSameRule('/app', '/app/');
    });

    it('matches /login and /login/ to same rule', () => {
      assertSameRule('/login', '/login/');
    });

    it('matches /register and /register/ to same rule', () => {
      assertSameRule('/register', '/register/');
    });

    it('matches /dashboard and /dashboard/ to same rule', () => {
      assertSameRule('/dashboard', '/dashboard/');
    });

    // ADR-0015 §7.1: a link is navigation and the API is the boundary, so the
    // three area rules stay auth-only. Re-adding `allowedAccountTypes` here is
    // the exact bug the phase removes (a Student persona who is Admin in org B
    // could not reach `/manage`), so a persona gate fails this audit.
    it.each(['/manage', '/edu', '/app'])('%s requires auth and no persona', (path) => {
      const rule = matchRule(path);
      expect(rule?.requireAuth).toBe(true);
      expect(rule?.allowedAccountTypes).toBeUndefined();
    });

    it('/setup keeps the two declared persona exceptions', () => {
      expect(matchRule('/setup/org')?.allowedAccountTypes).toEqual(['manager']);
      expect(matchRule('/setup')?.allowedAccountTypes).toEqual(['educator']);
    });

    it('redirects a signed-in visitor from /login to the neutral landing', () => {
      const rule = matchRule('/login');
      expect(rule?.redirectIfAuthenticated).toBe('/dashboard');
    });

    it('/dashboard requires auth', () => {
      expect(matchRule('/dashboard')?.requireAuth).toBe(true);
    });
  });
});
