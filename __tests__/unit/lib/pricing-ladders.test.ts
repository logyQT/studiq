import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import { describe, expect, it } from 'vitest';
import en from '@/i18n/messages/en.json';
import pl from '@/i18n/messages/pl.json';
import {
  canBuyPlan,
  ctaMessageKey,
  formatLimitValue,
  getPlanLadders,
  isRecommendedPlan,
  shortPlanName,
  splitFeatureRows,
  splitLimitRows,
} from '@/lib/pricing-ladders';

// The /pricing page is one URL for two audiences: the catalogue arrives as one flat
// list and this module is what turns it into the student, educator and organization
// ladders the page prints.

function plan(
  key: string,
  scope: 'personal' | 'organization',
  audience: string | null,
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
    audience,
    seatEligible: false,
    ...rest,
  };
}

// Catalogue order is deliberate: `sort_order` is global across the ladders, so the
// seed interleaves them (base 1, lite 2, launch 3, spark 4, …). Prices are the
// seed's, in grosze, so `ctaMessageKey` sees the real free/paid split.
const catalogue = [
  plan('base', 'personal', 'student', 1, { features: ['flashcards', 'quiz'] }),
  plan('lite', 'personal', 'educator', 2, { features: ['flashcards', 'quiz', 'group.manage'] }),
  plan('launch', 'organization', null, 3, { features: ['flashcards', 'quiz'] }),
  plan('spark', 'personal', 'student', 4, { features: ['flashcards', 'quiz'], priceMonthly: 999 }),
  plan('guide', 'personal', 'educator', 5, {
    features: ['flashcards', 'quiz'],
    priceMonthly: 1999,
  }),
  plan('team', 'organization', null, 6, { features: ['flashcards', 'quiz'], priceMonthly: 9900 }),
  plan('ace', 'personal', 'student', 7, {
    features: ['flashcards', 'quiz', 'ai.chat'],
    priceMonthly: 1999,
  }),
  plan('creator', 'personal', 'educator', 8, {
    features: ['flashcards', 'quiz', 'ai.chat'],
    priceMonthly: 3999,
  }),
  plan('hub', 'organization', null, 9, {
    features: ['flashcards', 'quiz', 'ai.chat'],
    priceMonthly: 29900,
  }),
  plan('pro', 'personal', 'student', 10, {
    features: ['flashcards', 'quiz', 'ai.chat'],
    priceMonthly: 3999,
  }),
  plan('master', 'personal', 'educator', 11, {
    features: ['flashcards', 'quiz', 'ai.chat'],
    priceMonthly: 7999,
  }),
  plan('campus', 'organization', null, 12, {
    features: ['flashcards', 'quiz', 'ai.chat'],
    priceMonthly: 69900,
  }),
  // `solo` is the free manager personal plan: it is in the catalogue but in
  // no pricing ladder (D2/D34).
  plan('solo', 'personal', 'manager', 13, { features: ['flashcards', 'quiz'] }),
];

describe('getPlanLadders', () => {
  it('splits the flat catalogue into one ordered ladder per account type', () => {
    const ladders = getPlanLadders(catalogue);

    expect(ladders.individual.student.map((p) => p.key)).toEqual(['base', 'spark', 'ace', 'pro']);
    expect(ladders.individual.educator.map((p) => p.key)).toEqual([
      'lite',
      'guide',
      'creator',
      'master',
    ]);
    expect(ladders.organization.map((p) => p.key)).toEqual(['launch', 'team', 'hub', 'campus']);
    // `solo` is a manager-personal plan, not a manager pricing ladder entry.
    expect(catalogue.map((p) => p.key)).toContain('solo');
    expect(ladders.individual.student.map((p) => p.key)).not.toContain('solo');
    expect(ladders.individual.educator.map((p) => p.key)).not.toContain('solo');
    expect(ladders.organization.map((p) => p.key)).not.toContain('solo');
  });

  it('sorts by the catalogue order rather than the order the API returned', () => {
    const shuffled = catalogue.toReversed();

    expect(getPlanLadders(shuffled).individual.student.map((p) => p.key)).toEqual([
      'base',
      'spark',
      'ace',
      'pro',
    ]);
  });

  it('keeps the ladders to active plans', () => {
    const withRetired = [
      ...catalogue,
      plan('retired', 'personal', 'student', 0, { isActive: false }),
    ];

    expect(getPlanLadders(withRetired).individual.student.map((p) => p.key)).not.toContain(
      'retired',
    );
  });
});

describe('isRecommendedPlan', () => {
  it('gives every ladder exactly one plan the signal action can belong to', () => {
    const { individual, organization } = getPlanLadders(catalogue);
    const ladders = [
      { plans: individual.student, recommended: 'ace' },
      { plans: individual.educator, recommended: 'creator' },
      { plans: organization, recommended: 'hub' },
    ];

    for (const { plans, recommended } of ladders) {
      expect(plans.filter((row) => isRecommendedPlan(row.key)).map((row) => row.key)).toEqual([
        recommended,
      ]);
    }
  });
});

describe('canBuyPlan', () => {
  it('lets a reader buy a paid personal plan of their own audience', () => {
    expect(
      canBuyPlan(plan('guide', 'personal', 'educator', 5, { priceMonthly: 1999 }), 'educator'),
    ).toBe(true);
    expect(canBuyPlan(plan('solo', 'personal', 'manager', 13), 'manager')).toBe(true);
  });

  it('lets any reader buy an organization plan — it has no audience check (D34)', () => {
    expect(
      canBuyPlan(plan('hub', 'organization', null, 9, { priceMonthly: 29900 }), 'student'),
    ).toBe(true);
    expect(
      canBuyPlan(plan('hub', 'organization', null, 9, { priceMonthly: 29900 }), 'manager'),
    ).toBe(true);
  });

  it('does not offer another audience’s personal plan to the reader', () => {
    // A student sees the educator ladder on the same page; the server refuses
    // that purchase with FORBIDDEN (#1274).
    expect(
      canBuyPlan(plan('guide', 'personal', 'educator', 5, { priceMonthly: 1999 }), 'student'),
    ).toBe(false);
    expect(
      canBuyPlan(plan('ace', 'personal', 'student', 7, { priceMonthly: 1999 }), 'manager'),
    ).toBe(false);
    expect(canBuyPlan(plan('solo', 'personal', 'manager', 13), 'student')).toBe(false);
  });

  it('fails closed when the caller’s account type is missing or unknown', () => {
    // `app_metadata.account_type` is an untyped map: a missing value must not
    // open a purchase the button cannot complete.
    for (const unknown of [undefined, null, '', 'teacher']) {
      expect(
        canBuyPlan(plan('guide', 'personal', 'educator', 5, { priceMonthly: 1999 }), unknown),
      ).toBe(false);
      expect(
        canBuyPlan(plan('hub', 'organization', null, 9, { priceMonthly: 29900 }), unknown),
      ).toBe(false);
    }
  });
});

describe('ctaMessageKey', () => {
  it('gives a free plan the shared free action', () => {
    expect(ctaMessageKey(plan('base', 'personal', 'student', 1))).toBe('cta_free');
  });

  it('names the plan in a paid plan’s own action', () => {
    expect(ctaMessageKey(plan('spark', 'personal', 'student', 4, { priceMonthly: 999 }))).toBe(
      'cta_spark',
    );
  });

  it('gives a sales-led plan the conversation the page already offers', () => {
    expect(ctaMessageKey(plan('campus', 'organization', null, 12, { priceMonthly: 69900 }))).toBe(
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
    expect(shortPlanName('StudiQ Ace')).toBe('Ace');
    expect(shortPlanName('Ace')).toBe('Ace');
  });
});

describe('splitFeatureRows', () => {
  it('separates what every plan carries from what distinguishes them', () => {
    const { common, differing } = splitFeatureRows(getPlanLadders(catalogue).individual.student);

    expect(common).toEqual(['flashcards', 'quiz']);
    expect(differing).toEqual(['ai.chat']);
  });

  it('tabulates every plan feature, common and differing', () => {
    // No feature is excluded from the comparison any more: the legacy
    // management markers left the catalog in 2b-7, so a plan-specific key
    // lands in `differing` instead of being silently dropped.
    const ladder = [
      plan('launch', 'organization', null, 1, { features: ['flashcards'] }),
      plan('team', 'organization', null, 2, { features: ['flashcards', 'branding'] }),
    ];

    const rows = splitFeatureRows(ladder);

    expect(rows.common).toEqual(['flashcards']);
    expect(rows.differing).toEqual(['branding']);
  });
});

describe('splitLimitRows', () => {
  it('keeps the limit that separates the plans and drops the one they share', () => {
    const ladder = [
      plan('base', 'personal', 'student', 1, { limits: { max_flashcards: 100, max_decks: 10 } }),
      plan('spark', 'personal', 'student', 2, { limits: { max_flashcards: 500, max_decks: 10 } }),
    ];

    expect(splitLimitRows(ladder)).toEqual(['max_flashcards']);
  });

  it('keeps a seat limit on an educator ladder', () => {
    const ladder = [
      plan('lite', 'personal', 'educator', 1, { limits: { max_students: 5 } }),
      plan('guide', 'personal', 'educator', 2, { limits: { max_students: 50 } }),
    ];

    expect(splitLimitRows(ladder)).toEqual(['max_students']);
  });

  it('keeps the seat limits on the organization ladder (no audience means org caps)', () => {
    const ladder = [
      plan('launch', 'organization', null, 1, { limits: { max_students: 5 } }),
      plan('hub', 'organization', null, 2, { limits: { max_students: 50 } }),
    ];

    expect(splitLimitRows(ladder)).toEqual(['max_students']);
  });

  it('drops the seat limits a student ladder cannot enforce', () => {
    const ladder = [
      plan('base', 'personal', 'student', 1, { limits: { max_flashcards: 100, max_students: -1 } }),
      plan('spark', 'personal', 'student', 2, { limits: { max_flashcards: 500 } }),
    ];

    expect(splitLimitRows(ladder)).toEqual(['max_flashcards']);
  });

  it('drops a row whose cells would all read the same even though the raw values differ', () => {
    const ladder = [
      plan('base', 'personal', 'student', 1, { limits: { max_ai_tokens_per_day: 0 } }),
      plan('spark', 'personal', 'student', 2, { limits: {} }),
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
