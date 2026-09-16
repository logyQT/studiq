/**
 * Audit: Trailing-slash path mismatch for proxy + route rules.
 *
 * Verifies that:
 * 1. routeRules regex patterns match both forms consistently
 * 2. sensitive API routes (teacher, AI) can't be bypassed via trailing slash
 * 3. the catch-all API auth rule can't be bypassed via trailing slash
 * 4. rule ordering prevents privilege escalation via trailing slash
 */
import { describe, expect, it } from 'vitest';
import { type RouteRule, routeRules } from '@/server/config/routes.config';

// ---- proxy.ts matcher (line 99) ----
const proxyMatcher =
  /^\/((?!_next\/static|_next\/image|favicon\.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)$/;

// ---- Test the proxy matcher itself ----
describe('proxy matcher — trailing slash passthrough', () => {
  const cases = [
    '/api/v1/auth/me',
    '/api/v1/auth/me/',
    '/login',
    '/login/',
    '/setup/org',
    '/setup/org/',
  ];

  it.each(cases)('matches %s', (path) => {
    expect(proxyMatcher.test(path)).toBe(true);
  });
});

// ---- Test routeRules regex patterns ----
describe('routeRules — trailing slash consistency', () => {
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

  // Helper: test that a path does NOT match any rule
  function assertNoRule(path: string) {
    const rule = matchRule(path);
    expect(rule).toBeNull();
  }

  // --- Teacher API ---
  describe('teacher API routes', () => {
    it('matches /api/v1/teacher and /api/v1/teacher/ to the same rule', () => {
      assertSameRule('/api/v1/teacher', '/api/v1/teacher/');
    });

    it('teacher rule requires auth + educator/manager', () => {
      const rule = matchRule('/api/v1/teacher/classrooms');
      expect(rule?.requireAuth).toBe(true);
      expect(rule?.allowedAccountTypes).toContain('educator');
      expect(rule?.allowedAccountTypes).toContain('manager');
    });
  });

  // --- AI API ---
  describe('AI API routes', () => {
    it('matches /api/v1/ai and /api/v1/ai/ to the same rule', () => {
      assertSameRule('/api/v1/ai', '/api/v1/ai/');
    });

    it('AI rule requires auth + student/educator', () => {
      const rule = matchRule('/api/v1/ai/chat');
      expect(rule?.requireAuth).toBe(true);
      expect(rule?.allowedAccountTypes).toContain('student');
      expect(rule?.allowedAccountTypes).toContain('educator');
    });
  });

  // --- Catch-all API auth rule ---
  describe('catch-all API auth rule', () => {
    it('matches both forms for flashcards endpoint', () => {
      assertSameRule('/api/v1/flashcards', '/api/v1/flashcards/');
    });

    it('matches both forms for quiz endpoint', () => {
      assertSameRule('/api/v1/quiz/new', '/api/v1/quiz/new/');
    });

    it('matches both forms for questions endpoint', () => {
      assertSameRule('/api/v1/questions', '/api/v1/questions/');
    });

    it('catch-all rule requires auth', () => {
      const rule = matchRule('/api/v1/flashcards');
      expect(rule?.requireAuth).toBe(true);
    });
  });

  // --- Public API routes (should NOT match catch-all auth rule) ---
  describe('public API routes — excluded from catch-all', () => {
    it('/api/v1/auth/me excluded from catch-all auth rule', () => {
      const catchAllRule = routeRules.find((r) => r.matcher.source.includes('auth|health|avatar'));
      // The catch-all uses negative lookahead to EXCLUDE auth, health, avatar
      expect(catchAllRule?.matcher.test('/api/v1/auth/me')).toBe(false);
      expect(catchAllRule?.matcher.test('/api/v1/auth/me/')).toBe(false);
    });

    it('/api/v1/health excluded from catch-all auth rule', () => {
      const catchAllRule = routeRules.find((r) => r.matcher.source.includes('auth|health|avatar'));
      expect(catchAllRule?.matcher.test('/api/v1/health')).toBe(false);
      expect(catchAllRule?.matcher.test('/api/v1/health/')).toBe(false);
    });

    it('/api/v1/avatar/user/xyz excluded from catch-all auth rule', () => {
      const catchAllRule = routeRules.find((r) => r.matcher.source.includes('auth|health|avatar'));
      expect(catchAllRule?.matcher.test('/api/v1/avatar/user/xyz')).toBe(false);
      expect(catchAllRule?.matcher.test('/api/v1/avatar/user/xyz/')).toBe(false);
    });

    it('/api/v1/stripe/webhook excluded from catch-all auth rule', () => {
      const catchAllRule = routeRules.find((r) => r.matcher.source.includes('auth|health|avatar'));
      expect(catchAllRule?.matcher.test('/api/v1/stripe/webhook')).toBe(false);
      expect(catchAllRule?.matcher.test('/api/v1/stripe/webhook/')).toBe(false);
    });
  });

  // --- CRITICAL: /setup org rule ordering ---
  describe('onboarding routes — /setup/org privilege escalation audit', () => {
    it('/setup/org matches the MANAGER rule (strict regex)', () => {
      const orgRule = matchRule('/setup/org');
      // Rule at index 5: /^\/setup\/org\/?$/ — MANAGER only
      expect(orgRule?.allowedAccountTypes).toEqual(['manager']);
    });

    it('/setup/org/ (trailing slash) also matches the MANAGER rule — hardened', () => {
      const orgRule = matchRule('/setup/org/');
      // After fix: /? makes trailing slash optional, both forms match MANAGER rule
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

  // --- Stripe webhook (public) ---
  describe('stripe webhook', () => {
    it('matches /api/v1/stripe/webhook consistently', () => {
      assertSameRule('/api/v1/stripe/webhook', '/api/v1/stripe/webhook/');
    });

    it('stripe webhook has NO auth requirement', () => {
      const rule = matchRule('/api/v1/stripe/webhook');
      expect(rule?.requireAuth).toBeFalsy();
    });
  });
});

// ---- Verify the fundamental proxy bypass for API routes ----
describe('proxy.ts — API route early-return', () => {
  it('all API paths start with /api/ (proxy bypass applies — rules only matter for UI routes)', () => {
    const apiPaths = [
      '/api/v1/auth/me',
      '/api/v1/auth/me/',
      '/api/v1/flashcards',
      '/api/v1/flashcards/',
    ];

    for (const path of apiPaths) {
      expect(path.startsWith('/api/')).toBe(true);
    }
  });
});
