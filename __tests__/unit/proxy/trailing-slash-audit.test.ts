/**
 * Audit: trailing-slash consistency of the UI route rules.
 *
 * `apps/web/src/proxy.ts` returns for every `/api/*` request before consulting
 * `routeRules`, so the rules only describe UI paths; the API surface is audited
 * by `api-auth-inventory.test.ts`.
 *
 * Verifies that:
 * 1. routeRules patterns match both the plain and the trailing-slash form
 * 2. rule ordering keeps `/setup/org` on the MANAGER rule, not the EDUCATOR one
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
  describe('onboarding routes — /setup/org privilege escalation audit', () => {
    it('/setup/org matches the MANAGER rule (strict regex)', () => {
      const orgRule = matchRule('/setup/org');
      expect(orgRule?.allowedAccountTypes).toEqual(['manager']);
    });

    it('/setup/org/ (trailing slash) also matches the MANAGER rule — hardened', () => {
      const orgRule = matchRule('/setup/org/');
      expect(orgRule?.allowedAccountTypes).toEqual(['manager']);
    });

    it('/setup (without /org) matches the EDUCATOR catch-all rule', () => {
      const setupRule = matchRule('/setup');
      expect(setupRule?.allowedAccountTypes).toEqual(['educator']);
    });

    it('/setup/ (with trailing slash) matches the EDUCATOR catch-all rule', () => {
      const setupRule = matchRule('/setup/');
      expect(setupRule?.allowedAccountTypes).toEqual(['educator']);
    });

    it('/setup/anything matches the EDUCATOR catch-all rule', () => {
      const setupRule = matchRule('/setup/some-page');
      expect(setupRule?.allowedAccountTypes).toEqual(['educator']);
    });
  });

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

    it('/app requires auth + student', () => {
      const rule = matchRule('/app');
      expect(rule?.requireAuth).toBe(true);
      expect(rule?.allowedAccountTypes).toContain('student');
    });
  });
});
