import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import { getVisibleLimitKeys } from '@/lib/pricing-limits';

/**
 * The one plan per ladder that carries the page's single `signal` action. Every
 * other row stays quiet, so a ladder has one destination rather than four
 * (DESIGN §Dosage: one primary action per screen): Pro on the individual ladder,
 * Hub on the organization ladder.
 */
const RECOMMENDED_PLAN_KEYS: readonly string[] = ['ace', 'hub'];

export function isRecommendedPlan(key: string): boolean {
  return RECOMMENDED_PLAN_KEYS.includes(key);
}

/**
 * The message key of a plan's own action. A zero price is the free action every
 * free tier shares; a paid plan names itself, so the label cannot borrow another
 * tier's verb. Both the price list and the dashboard card ask this, so a new plan
 * needs a `cta_<key>` message and nothing else.
 */
/**
 * Plans sold through a conversation rather than a checkout. The label is the one
 * sales verb the page already uses, not a per-plan string: "Kontakt z działem
 * handlowym" is wider than the price list's action column and ran over the
 * figure beside it.
 */
const SALES_LED_PLAN_KEYS: readonly string[] = ['campus'];

export function ctaMessageKey(plan: Pick<PlanInfo, 'key' | 'priceMonthly'>): string {
  if (plan.priceMonthly === 0) return 'cta_free';
  if (SALES_LED_PLAN_KEYS.includes(plan.key)) return 'cta_contact';
  return `cta_${plan.key}`;
}

export type PlanLadders = {
  individual: PlanInfo[];
  organization: PlanInfo[];
};

/** Active personal plans, in the catalogue's own order. */
function personalLadder(plans: readonly PlanInfo[]): PlanInfo[] {
  return plans
    .filter((plan) => plan.isActive && plan.scope === 'personal')
    .toSorted((a, b) => a.sortOrder - b.sortOrder);
}

/** Active organization plans, in the catalogue's own order. */
function organizationLadder(plans: readonly PlanInfo[]): PlanInfo[] {
  return plans
    .filter((plan) => plan.isActive && plan.scope === 'organization')
    .toSorted((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * The catalogue is one flat list because `sort_order` is global across the
 * ladders, so the page splits it here instead of asking the API twice.
 */
export function getPlanLadders(plans: readonly PlanInfo[]): PlanLadders {
  return {
    individual: personalLadder(plans),
    organization: organizationLadder(plans),
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
 * Every plan feature is tabulated — the legacy management markers left the
 * catalog in phase 2b-7, so there is no key left to exclude here.
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
 * Numbers are grouped in the reader's locale (`200 000` / `200,000`). The
 * organization ladder prints three plan columns, so the exact figure fits the
 * narrowest gutter; nothing is abbreviated away.
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
 * are identical on every plan. Seats and groups are dropped from a personal
 * ladder by `getVisibleLimitKeys`, and the comparison is made on the printed
 * value, so two plans whose caps both read `—` do not make a row either.
 */
export function splitLimitRows(plans: readonly PlanInfo[]): string[] {
  // The organization ladder shows the seat/group limits; a personal ladder
  // never does, because no personal plan carries them.
  const scope = plans[0]?.scope === 'organization' ? 'organization' : 'personal';
  return getVisibleLimitKeys(plans, scope).filter((key) => {
    const tokens = new Set(plans.map((plan) => capacityToken(plan.limits[key])));
    return tokens.size > 1;
  });
}
