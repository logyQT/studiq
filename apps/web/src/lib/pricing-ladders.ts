import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';

/**
 * The one plan per ladder that carries the page's single `signal` action. Every
 * other row stays quiet, so a ladder has one destination rather than four
 * (DESIGN §Dosage: one primary action per screen).
 */
export const RECOMMENDED_PLAN_KEYS: readonly string[] = ['ace', 'creator', 'hub'];

export function isRecommendedPlan(key: string): boolean {
  return RECOMMENDED_PLAN_KEYS.includes(key);
}

export type PlanLadders = {
  individual: {
    student: PlanInfo[];
    educator: PlanInfo[];
  };
  organization: PlanInfo[];
};

/** Active plans of one account type, in the catalogue's own order. */
function ladder(plans: readonly PlanInfo[], accountType: string): PlanInfo[] {
  return plans
    .filter((plan) => plan.isActive && plan.forAccountType === accountType)
    .toSorted((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * The catalogue is one flat list because `sort_order` is global across the three
 * ladders, so the page splits it here instead of asking the API three times.
 */
export function getPlanLadders(plans: readonly PlanInfo[]): PlanLadders {
  return {
    individual: {
      student: ladder(plans, 'student'),
      educator: ladder(plans, 'educator'),
    },
    organization: ladder(plans, 'manager'),
  };
}

/** `StudiQ Ace` → `Ace`: the page says StudiQ already, the tier is the column. */
export function shortPlanName(name: string): string {
  return name.replace(/^StudiQ\s+/i, '').trim();
}

export type FeatureRows = {
  /** Carried by every plan in the ladder — printed once above the table. */
  common: string[];
  /** Carried by some plans only — the table's rows. */
  differing: string[];
};

/**
 * Splits a ladder's features so no string is printed twice: the intersection
 * becomes the "all plans include" line, the rest becomes the comparison rows.
 */
export function splitFeatureRows(plans: readonly PlanInfo[]): FeatureRows {
  const carriers = new Map<string, number>();
  for (const plan of plans) {
    for (const feature of plan.features) {
      carriers.set(feature, (carriers.get(feature) ?? 0) + 1);
    }
  }

  const all = [...carriers.keys()].toSorted();
  return {
    common: all.filter((feature) => carriers.get(feature) === plans.length),
    differing: all.filter((feature) => carriers.get(feature) !== plans.length),
  };
}
