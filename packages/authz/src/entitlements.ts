import type { LimitKey } from './limits';

/**
 * Canonical entitlement catalog — the single source of truth for product access
 * (ADR-0015 §5.1). `entitlement_catalog`, `plan_entitlements`,
 * `entitlement_flags`, `org_role_features` and `user_feature_overrides` all store
 * these exact keys; the DB rows are pinned to this object by
 * `__tests__/integration/catalog-invariants.test.ts`.
 *
 * Entitlements are product access, never authority. `Permission` owns
 * authorization; the two namespaces are disjoint (phase 2b-7 removed the four
 * legacy management markers — `group.manage` is a permission, §4.1).
 */
export type Entitlement = {
  category: 'baseline' | 'surface';
  scope: 'personal' | 'org';
  /** A seat plan may carry this key (D15: a seat plan's keys must all be eligible). */
  seatEligible: boolean;
  /** A personal plan may add this key inside an org (§5.5, the #971 contract). */
  personalPortable: boolean;
  quota: LimitKey | null;
};

/**
 * Declaration order is the `/features/me` payload order (`EntitlementResolver`
 * emits it), so it is kept stable across the catalog rename: adding a key appends.
 *
 * `documents` is absent in v1 (phase 1c): it has no surface, and ADR §5.1 keeps
 * it out of the catalog until it does. Phase 5 has no surface to gate;
 * `documents` stays absent until its surface ships (D22).
 */
export const ENTITLEMENTS = {
  'ai.chat': {
    category: 'surface',
    scope: 'personal',
    seatEligible: true,
    personalPortable: true,
    quota: 'max_ai_tokens_per_day',
  },
  flashcards: {
    category: 'baseline',
    scope: 'personal',
    seatEligible: true,
    personalPortable: false,
    quota: 'max_flashcards',
  },
  quiz: {
    category: 'baseline',
    scope: 'personal',
    seatEligible: true,
    personalPortable: false,
    quota: 'max_quiz_attempts_per_day',
  },
  'quiz.templates': {
    category: 'surface',
    scope: 'personal',
    seatEligible: true,
    personalPortable: true,
    quota: null,
  },
  'stats.insights': {
    category: 'surface',
    scope: 'personal',
    seatEligible: true,
    personalPortable: true,
    quota: null,
  },
  branding: {
    category: 'surface',
    scope: 'org',
    seatEligible: false,
    personalPortable: false,
    quota: null,
  },
} as const satisfies Record<string, Entitlement>;

export type EntitlementKey = keyof typeof ENTITLEMENTS;

const ENTITLEMENT_KEY_SET: ReadonlySet<string> = new Set<string>(Object.keys(ENTITLEMENTS));

export function isEntitlementKey(key: string): key is EntitlementKey {
  return ENTITLEMENT_KEY_SET.has(key);
}

/** Every entitlement key, narrowed from the catalog's own keys (no cast). */
export const ENTITLEMENT_KEYS: readonly EntitlementKey[] =
  Object.keys(ENTITLEMENTS).filter(isEntitlementKey);

/**
 * Surface entitlements are the ones a flag row has to exist for (§8.2 #8);
 * baseline keys are always on and present only for pricing display (§5.1).
 */
export const SURFACE_ENTITLEMENT_KEYS: readonly EntitlementKey[] = ENTITLEMENT_KEYS.filter(
  (key) => ENTITLEMENTS[key].category === 'surface',
);

/**
 * The three-valued role entitlement profile (ADR-0015 §5.3, D5).
 */
export const ENTITLEMENT_PROFILES = ['all', 'learner', 'none'] as const;

export type EntitlementProfile = (typeof ENTITLEMENT_PROFILES)[number];

export function isEntitlementProfile(value: string): value is EntitlementProfile {
  return (ENTITLEMENT_PROFILES as readonly string[]).includes(value);
}

/**
 * The fixed Member set (ADR-0015 §5.3): always intersected with the org plan
 * ceiling, so a plan change needs no prune job. `documents` joins only when its
 * surface ships (§5.1); it is absent in v1 for exactly that reason.
 */
export const LEARNER_ENTITLEMENTS: readonly EntitlementKey[] = [
  'flashcards',
  'quiz',
  'ai.chat',
  'branding',
];

/** Where one plan layer of a resolution came from (ADR-0015 §6.1 `sources`). */
export interface PlanSource {
  planKey: string;
  origin: 'org' | 'seat' | 'personal';
}

/**
 * The single resolution result (ADR-0015 §6.1): entitlements, limits and the
 * provenance of every layer, produced by `resolveEntitlements(ctx)` in
 * `packages/server/src/services/entitlement.resolver.ts` — the only reader of
 * the plan/role/seat/override/flag tables.
 */
export interface ResolvedEntitlements {
  /** Effective entitlement keys, ordered by `ENTITLEMENT_KEYS`; quota==0 keys excluded (§6.1). */
  entitlements: EntitlementKey[];
  /** Effective limits keyed by limit key; a missing `plan_limits` row is `0`. */
  limits: Record<string, number>;
  /** Where each layer came from, for `/me/plan` and debugging. */
  sources: {
    org: PlanSource | null;
    seat: PlanSource | null;
    personal: PlanSource | null;
    /** Keys an active user override added. */
    overrides: EntitlementKey[];
    /** Keys an active user override removed. */
    revokedOverrides: EntitlementKey[];
    /** `org_role_features` `is_enabled=false` rows (D19, readable until phase 7). */
    revokedRoleRows: EntitlementKey[];
    /** Surface keys removed by a kill-switched or missing flag row (fails closed). */
    flagsOff: EntitlementKey[];
  };
  /** Union descriptor, not a single key (ADR-0015 §6.1). */
  plan: { primary: string; sources: PlanSource[] };
}
