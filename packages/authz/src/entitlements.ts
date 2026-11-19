import type { LimitKey } from './limits';

/**
 * Canonical entitlement catalog — the single source of truth for product access
 * (ADR-0015 §5.1). `entitlement_catalog`, `plan_entitlements`,
 * `entitlement_flags`, `org_role_features` and `user_feature_overrides` all store
 * these exact keys; the DB rows are pinned to this object by
 * `__tests__/integration/catalog-invariants.test.ts`.
 *
 * Entitlements are product access, never authority. `Permission` owns
 * authorization; the namespaces are disjoint once phase 2 removes the four
 * legacy management markers (`group.manage` is a permission today, so it is the
 * one deliberate overlap until then — §3.1).
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
 * Declaration order is the `/features/me` payload order (`FeatureResolver` emits
 * it), so it is kept stable across the catalog rename: adding a key appends.
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
  'quiz.builder': {
    category: 'surface',
    scope: 'personal',
    seatEligible: true,
    personalPortable: true,
    quota: null,
  },
  // Legacy management markers: the route and RLS gates still read them as
  // entitlements until phase 2 turns them into permissions. Removed in phase 2.
  'org.manage': {
    category: 'surface',
    scope: 'org',
    seatEligible: false,
    personalPortable: false,
    quota: null,
  },
  'group.manage': {
    category: 'surface',
    scope: 'org',
    seatEligible: false,
    personalPortable: false,
    quota: null,
  },
  'member.manage': {
    category: 'surface',
    scope: 'org',
    seatEligible: false,
    personalPortable: false,
    quota: null,
  },
  'role.builder': {
    category: 'surface',
    scope: 'org',
    seatEligible: false,
    personalPortable: false,
    quota: null,
  },
  'advanced.stats': {
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
 * Structure privileges that belong to the org admin role only. A seat or a
 * personal plan can never hand them to a non-admin role.
 */
export const ADMIN_ONLY_ENTITLEMENTS: ReadonlySet<EntitlementKey> = new Set<EntitlementKey>([
  'org.manage',
  'member.manage',
  'role.builder',
]);

/**
 * Entitlements describing control over the organization rather than the member's
 * own study surface. Derived from the catalog's `scope`, so the denylist can no
 * longer drift from the metadata: a personal plan adds none of these inside an
 * org.
 */
export const ORG_SCOPED_ENTITLEMENTS: ReadonlySet<EntitlementKey> = new Set<EntitlementKey>(
  ENTITLEMENT_KEYS.filter((key) => ENTITLEMENTS[key].scope === 'org'),
);

export interface EntitlementResolution {
  /** Enabled entitlement keys, ordered by `ENTITLEMENT_KEYS`. */
  features: EntitlementKey[];
  /**
   * The rollout percentage that was actually applied for each enabled
   * entitlement currently gated by a live rollout (i.e.
   * `rollout_percentage < 100`). The field still ships in the `/features/me`
   * response body; only the `X-Feature-Rollout` header was removed (phase 0b),
   * and phase 3 / D8 removes the field and the column.
   */
  rollout: Partial<Record<EntitlementKey, number>>;
}

/**
 * Deterministic per-(key, user) rollout bucket in `0..99`. Stable across
 * requests (FNV-1a over `${key}:${userId}`), so a given user either always
 * sees a partially-rolled-out entitlement or never does — no flapping.
 */
export function rolloutBucket(userId: string, key: EntitlementKey): number {
  let hash = 0x811c9dc5;
  const input = `${key}:${userId}`;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash % 100;
}
