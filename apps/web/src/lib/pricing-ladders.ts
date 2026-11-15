import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import { getVisibleLimitKeys } from '@/lib/pricing-limits';

/**
 * The one plan per ladder that carries the page's single `signal` action. Every
 * other row stays quiet, so a ladder has one destination rather than four
 * (DESIGN §Dosage: one primary action per screen).
 */
const RECOMMENDED_PLAN_KEYS: readonly string[] = ['ace', 'creator', 'hub'];

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

/** Uncapped, and the one token for a cap the plan does not offer. */
const UNLIMITED = '∞';
const ABSENT = '—';

/**
 * What a comparison cell prints for one limit. `-1` is the catalogue's
 * "unlimited", a cap of `0` is "not offered" — printing `0 / dzień` reads as a
 * rendering bug (N-14) — and a missing key means the same thing as `0`.
 *
 * Numbers are grouped in the reader's locale (`200 000` / `200,000`). Measured
 * at 320px on `/pricing?audience=organization`: the five columns fill the 288px
 * gutter exactly, the label column at its 94px minimum and the widest numeric
 * column (`200 000` under Hub) at 50px, with no cell clipping and no horizontal
 * scroll — so the exact figure fits and nothing is abbreviated away.
 */
export function formatLimitValue(value: number | undefined, locale: string): string {
  if (value === undefined || value === 0) return ABSENT;
  if (value < 0) return UNLIMITED;
  return new Intl.NumberFormat(locale).format(value);
}

/**
 * A cap's identity, without the locale's digit grouping: two plans that print
 * the same token are one row, and two that both print `—` are none.
 */
function capacityToken(value: number | undefined): string {
  if (value === undefined || value === 0) return ABSENT;
  return value < 0 ? UNLIMITED : String(value);
}

/**
 * Limits to tabulate: the keys the ladder can show at all, minus the ones that
 * are identical on every plan. Seats and groups are dropped from a student
 * ladder by `getVisibleLimitKeys`, and the comparison is made on the printed
 * value, so two plans whose caps both read `—` do not make a row either.
 */
export function splitLimitRows(plans: readonly PlanInfo[]): string[] {
  // `for_account_type` is one value per ladder, so the first plan names it.
  const accountType = plans[0]?.forAccountType ?? '';
  return getVisibleLimitKeys(plans, accountType).filter((key) => {
    const tokens = new Set(plans.map((plan) => capacityToken(plan.limits[key])));
    return tokens.size > 1;
  });
}
