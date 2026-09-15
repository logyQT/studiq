/**
 * Audit: /setup/org trailing-slash hardening test.
 *
 * After the fix, /setup/org/ should match the MANAGER-only rule,
 * not fall through to the EDUCATOR catch-all.
 */
import { describe, it, expect } from 'vitest';
import { routeRules } from '@/server/config/routes.config';

function matchRule(path: string) {
  return routeRules.find((rule) => rule.matcher.test(path)) ?? null;
}

describe('/setup/org trailing-slash hardening', () => {
  it('/setup/org requires MANAGER only', () => {
    const rule = matchRule('/setup/org');
    expect(rule?.requireAuth).toBe(true);
    expect(rule?.allowedAccountTypes).toEqual(['manager']);
  });

  it('/setup/org/ (trailing slash) also requires MANAGER only — hardened', () => {
    const rule = matchRule('/setup/org/');
    expect(rule?.requireAuth).toBe(true);
    expect(rule?.allowedAccountTypes).toEqual(['manager']);
  });

  it('both paths resolve to the same rule', () => {
    const ruleA = matchRule('/setup/org');
    const ruleB = matchRule('/setup/org/');
    expect(ruleA?.matcher.source).toBe(ruleB?.matcher.source);
  });

  it('/setup (without /org) still allows EDUCATOR', () => {
    const rule = matchRule('/setup');
    expect(rule?.allowedAccountTypes).toEqual(['educator']);
  });

  it('/setup/anything still allows EDUCATOR', () => {
    const rule = matchRule('/setup/some-page');
    expect(rule?.allowedAccountTypes).toEqual(['educator']);
  });
});
