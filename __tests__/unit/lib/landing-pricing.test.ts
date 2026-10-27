import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import { describe, expect, it } from 'vitest';
import en from '@/i18n/messages/en.json';
import pl from '@/i18n/messages/pl.json';
import { formatPlanPrice, pickLandingPlans } from '@/lib/landing-pricing';

// #283: the landing pricing teaser was hardcoded English with USD prices and disagreed with the
// real, DB-driven plans. It now picks real plans and formats them in the visitor locale.

function plan(key: string, priceMonthly: number, currency = 'PLN'): PlanInfo {
  return { key, name: `StudiQ ${key}`, priceMonthly, currency } as unknown as PlanInfo;
}

const student = [plan('base', 0), plan('spark', 999), plan('ace', 1999), plan('pro', 4999)];
const manager = [plan('launch', 0), plan('team', 999), plan('hub', 1999), plan('campus', 4999)];

describe('pickLandingPlans', () => {
  it('picks the free student plan, Ace as Premium and the cheapest paid org plan', () => {
    const picked = pickLandingPlans(student, manager);

    expect(picked.free?.key).toBe('base');
    expect(picked.premium?.key).toBe('ace');
    expect(picked.organizationFrom?.key).toBe('team');
  });

  it('never advertises the free organization plan as "from"', () => {
    expect(pickLandingPlans(student, manager).organizationFrom?.priceMonthly).toBeGreaterThan(0);
  });

  it('falls back to the cheapest paid student plan when Ace is missing', () => {
    const picked = pickLandingPlans([plan('base', 0), plan('pro', 4999), plan('spark', 999)], []);

    expect(picked.premium?.key).toBe('spark');
  });

  it('returns nulls while the plans are not loaded', () => {
    expect(pickLandingPlans([], [])).toEqual({
      free: null,
      premium: null,
      organizationFrom: null,
    });
  });
});

describe('formatPlanPrice', () => {
  it('formats in the plan currency, not in dollars', () => {
    const price = formatPlanPrice(plan('ace', 1999), 'pl');

    expect(price).toContain('19,99');
    expect(price).toContain('zł');
    expect(price).not.toContain('$');
  });

  it('drops the decimals for whole amounts', () => {
    expect(formatPlanPrice(plan('base', 0), 'pl')).toMatch(/^0\s?zł$/);
  });

  it('follows the visitor locale', () => {
    expect(formatPlanPrice(plan('ace', 1999), 'en')).toContain('19.99');
  });
});

describe('landing pricing messages', () => {
  const keys = [
    'pricing_premium_name',
    'pricing_premium_cta',
    'pricing_university_name',
    'pricing_from',
    'pricing_contact_cta',
    'pricing_university_feature_premium',
    'pricing_university_feature_management',
    'pricing_university_feature_roles',
    'pricing_university_feature_invites',
    'pricing_university_feature_analytics',
    'pricing_university_feature_support',
  ] as const;

  it.each([
    ['pl', pl],
    ['en', en],
  ])('translates every key the teaser uses in %s', (_locale, messages) => {
    const landing = messages.LandingPage as Record<string, string>;

    for (const key of keys) {
      expect(landing[key], `LandingPage.${key}`).toBeTypeOf('string');
      expect(landing[key]).not.toHaveLength(0);
    }
    expect(landing.pricing_from).toContain('{price}');
  });
});
