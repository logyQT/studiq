import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import { describe, expect, it } from 'vitest';
import {
  getPlanLadders,
  isRecommendedPlan,
  RECOMMENDED_PLAN_KEYS,
  shortPlanName,
  splitFeatureRows,
} from '@/lib/pricing-ladders';

// The /pricing page is one URL for two audiences: the catalogue arrives as one flat
// list and this module is what turns it into the student, educator and organization
// ladders the page prints.

function plan(
  key: string,
  forAccountType: string,
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
    forAccountType,
    ...rest,
  };
}

// Catalogue order is deliberate: `sort_order` is global across the ladders, so the
// seed interleaves them (base 1, lite 2, launch 3, spark 4, …).
const catalogue = [
  plan('base', 'student', 1, { features: ['flashcards', 'quiz'] }),
  plan('lite', 'educator', 2, { features: ['flashcards', 'quiz', 'group.manage'] }),
  plan('launch', 'manager', 3, { features: ['flashcards', 'quiz'] }),
  plan('spark', 'student', 4, { features: ['flashcards', 'quiz'] }),
  plan('guide', 'educator', 5, { features: ['flashcards', 'quiz'] }),
  plan('team', 'manager', 6, { features: ['flashcards', 'quiz'] }),
  plan('ace', 'student', 7, { features: ['flashcards', 'quiz', 'ai.chat'] }),
  plan('creator', 'educator', 8, { features: ['flashcards', 'quiz', 'ai.chat'] }),
  plan('hub', 'manager', 9, { features: ['flashcards', 'quiz', 'ai.chat'] }),
  plan('pro', 'student', 10, { features: ['flashcards', 'quiz', 'ai.chat'] }),
  plan('master', 'educator', 11, { features: ['flashcards', 'quiz', 'ai.chat'] }),
  plan('campus', 'manager', 12, { features: ['flashcards', 'quiz', 'ai.chat'] }),
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
    const withRetired = [...catalogue, plan('retired', 'student', 0, { isActive: false })];

    expect(getPlanLadders(withRetired).individual.student.map((p) => p.key)).not.toContain(
      'retired',
    );
  });
});

describe('isRecommendedPlan', () => {
  it('names one recommended plan per ladder', () => {
    expect(RECOMMENDED_PLAN_KEYS).toEqual(['ace', 'creator', 'hub']);
    expect(['ace', 'creator', 'hub'].every(isRecommendedPlan)).toBe(true);
    expect(['base', 'spark', 'pro', 'campus'].some(isRecommendedPlan)).toBe(false);
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

  it('claims nothing as common when there are no plans', () => {
    expect(splitFeatureRows([])).toEqual({ common: [], differing: [] });
  });
});
