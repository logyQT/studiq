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

    it('/app requires auth + student', () => {
      const rule = matchRule('/app');
      expect(rule?.requireAuth).toBe(true);
      expect(rule?.allowedAccountTypes).toContain('student');
    });
  });
});
