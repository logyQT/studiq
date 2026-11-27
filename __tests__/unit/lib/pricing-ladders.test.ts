import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import { describe, expect, it } from 'vitest';
import en from '@/i18n/messages/en.json';
import pl from '@/i18n/messages/pl.json';
import {
  ctaMessageKey,
  formatLimitValue,
  getPlanLadders,
  isRecommendedPlan,
  shortPlanName,
  splitFeatureRows,
  splitLimitRows,
} from '@/lib/pricing-ladders';

// The /pricing page is one URL for two buyers: the catalogue arrives as one flat
// list and this module turns it into the individual and organization ladders the
// page prints.

function plan(
  key: string,
  scope: 'personal' | 'organization',
  sortOrder: number,
  rest: Partial<PlanInfo> = {},
): PlanInfo {
  return {
    id: `plan-${key}`,
    key,
    name: `StudiQ ${key}`,
    description: null,
    priceMonthly: 0,
    priceYearly: 0,
    currency: 'PLN',
    features: [],
    limits: {},
    sortOrder,
    isActive: true,
    scope,
    seatEligible: false,
    ...rest,
  };
}

// Catalogue order is deliberate: `sort_order` is global across the ladders.
// Prices are the catalogue's, in grosze, so `ctaMessageKey` sees the real
// free/paid split.
const catalogue = [
  plan('free', 'personal', 1, { features: ['flashcards', 'quiz'] }),
  plan('plus', 'personal', 2, {
    features: ['ai.chat', 'flashcards', 'quiz', 'quiz.templates'],
    priceMonthly: 1999,
  }),
  plan('pro', 'personal', 3, {
    features: ['ai.chat', 'flashcards', 'quiz', 'quiz.templates', 'stats.insights'],
    priceMonthly: 3999,
  }),
  plan('max', 'personal', 4, {
    features: ['ai.chat', 'flashcards', 'quiz', 'quiz.templates', 'stats.insights'],
    priceMonthly: 7999,
  }),
  plan('launch', 'organization', 5, {
    features: ['flashcards', 'quiz'],
    limits: { max_students: 5, max_groups: 3 },
  }),
  plan('hub', 'organization', 6, {
    features: ['flashcards', 'quiz'],
    limits: { max_students: 50, max_groups: 20 },
    priceMonthly: 29900,
  }),
  plan('campus', 'organization', 7, {
    features: ['flashcards', 'quiz'],
    limits: { max_students: 1000, max_groups: 100 },
    priceMonthly: 69900,
  }),
];

describe('getPlanLadders', () => {
  it('splits the flat catalogue into one individual ladder and one organization ladder', () => {
    const ladders = getPlanLadders(catalogue);

    expect(ladders.individual.map((p) => p.key)).toEqual(['free', 'plus', 'pro', 'max']);
    expect(ladders.organization.map((p) => p.key)).toEqual(['launch', 'hub', 'campus']);
  });

  it('sorts by the catalogue order rather than the order the API returned', () => {
    const shuffled = catalogue.toReversed();

    expect(getPlanLadders(shuffled).individual.map((p) => p.key)).toEqual([
      'free',
      'plus',
      'pro',
      'max',
    ]);
  });

  it('keeps the ladders to active plans', () => {
    const withRetired = [...catalogue, plan('retired', 'personal', 0, { isActive: false })];

    expect(getPlanLadders(withRetired).individual.map((p) => p.key)).not.toContain('retired');
  });
});

describe('isRecommendedPlan', () => {
  it('gives every ladder exactly one plan the signal action can belong to', () => {
    const { individual, organization } = getPlanLadders(catalogue);
    const ladders = [
      { plans: individual, recommended: 'pro' },
      { plans: organization, recommended: 'hub' },
    ];

    for (const { plans, recommended } of ladders) {
      expect(plans.filter((row) => isRecommendedPlan(row.key)).map((row) => row.key)).toEqual([
        recommended,
      ]);
    }
  });
});

describe('ctaMessageKey', () => {
  it('gives a free plan the shared free action', () => {
    expect(ctaMessageKey(plan('free', 'personal', 1))).toBe('cta_free');
  });

  it('names the plan in a paid plan’s own action', () => {
    expect(ctaMessageKey(plan('plus', 'personal', 2, { priceMonthly: 1999 }))).toBe('cta_plus');
  });

  it('gives a sales-led plan the conversation the page already offers', () => {
    expect(ctaMessageKey(plan('campus', 'organization', 7, { priceMonthly: 69900 }))).toBe(
      'cta_contact',
    );
  });

  it('resolves every catalogue plan to a label both locales carry', () => {
    for (const row of catalogue) {
      const key = ctaMessageKey(row);
      expect(Object.keys(pl.PricingPage), `pl is missing ${key}`).toContain(key);
      expect(Object.keys(en.PricingPage), `en is missing ${key}`).toContain(key);
    }
  });
});

describe('shortPlanName', () => {
  it('drops the product prefix and leaves the tier', () => {
    expect(shortPlanName('StudiQ Pro')).toBe('Pro');
    expect(shortPlanName('Pro')).toBe('Pro');
  });
});

describe('splitFeatureRows', () => {
  it('separates what every plan carries from what distinguishes them', () => {
    const { common, differing } = splitFeatureRows(getPlanLadders(catalogue).individual);

    expect(common).toEqual(['flashcards', 'quiz']);
    expect(differing).toEqual(['ai.chat', 'quiz.templates', 'stats.insights']);
  });

  it('tabulates every plan feature, common and differing', () => {
    // No feature is excluded from the comparison any more: the legacy
    // management markers left the catalog in 2b-7, so a plan-specific key
    // lands in `differing` instead of being silently dropped.
    const ladder = [
      plan('launch', 'organization', 1, { features: ['flashcards'] }),
      plan('hub', 'organization', 2, { features: ['flashcards', 'branding'] }),
    ];

    const rows = splitFeatureRows(ladder);

    expect(rows.common).toEqual(['flashcards']);
    expect(rows.differing).toEqual(['branding']);
  });
});

describe('splitLimitRows', () => {
  it('keeps the limit that separates the plans and drops the one they share', () => {
    const ladder = [
      plan('free', 'personal', 1, { limits: { max_flashcards: 100, max_decks: 10 } }),
      plan('plus', 'personal', 2, { limits: { max_flashcards: 1000, max_decks: 10 } }),
    ];

    expect(splitLimitRows(ladder)).toEqual(['max_flashcards']);
  });

  it('keeps the seat limits on the organization ladder', () => {
    const ladder = [
      plan('launch', 'organization', 1, { limits: { max_students: 5 } }),
      plan('hub', 'organization', 2, { limits: { max_students: 50 } }),
    ];

    expect(splitLimitRows(ladder)).toEqual(['max_students']);
  });

  it('drops a seat limit a personal ladder cannot enforce', () => {
    const ladder = [
      plan('free', 'personal', 1, { limits: { max_flashcards: 100, max_students: 5 } }),
      plan('plus', 'personal', 2, { limits: { max_flashcards: 1000 } }),
    ];

    expect(splitLimitRows(ladder)).toEqual(['max_flashcards']);
  });

  it('drops a row whose cells would all read the same even though the raw values differ', () => {
    const ladder = [
      plan('free', 'personal', 1, { limits: { max_ai_tokens_per_day: 0 } }),
      plan('plus', 'personal', 2, { limits: {} }),
    ];

    expect(splitLimitRows(ladder)).toEqual([]);
  });
});

describe('formatLimitValue', () => {
  it('prints the catalogue unlimited marker as one glyph', () => {
    expect(formatLimitValue(-1, 'pl')).toBe('∞');
  });

  it('prints a cap the plan does not offer — and a missing one — as absent', () => {
    expect(formatLimitValue(0, 'pl')).toBe('—');
    expect(formatLimitValue(undefined, 'pl')).toBe('—');
  });

  it('prints a day limit without the unit, because the row label carries it', () => {
    expect(formatLimitValue(10, 'pl')).toBe('10');
  });

  it('groups the digits the way the reader’s locale does', () => {
    expect(formatLimitValue(200000, 'pl')).toMatch(/^200[\s\u00a0]000$/);
    expect(formatLimitValue(200000, 'en')).toBe('200,000');
  });
});
