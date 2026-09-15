// Canonical flat feature keys — the single source of truth for both the
// application AND the database. `feature_flags`, `plan_features`,
// `org_role_features` and `user_feature_overrides` all store these exact
// keys (no legacy snake_case aliases, no mapping layer).
export const FEATURES = [
  'ai.chat',
  'flashcards',
  'quiz',
  'quiz.builder',
  'documents',
  'org.manage',
  'group.manage',
  'member.manage',
  'role.builder',
  'advanced.stats',
] as const;
export type FeatureKey = (typeof FEATURES)[number];

const FEATURE_KEY_SET: ReadonlySet<string> = new Set<string>(FEATURES);

export function isFeatureKey(key: string): key is FeatureKey {
  return FEATURE_KEY_SET.has(key);
}

/**
 * Features that should never be granted to non-admin org roles through seat
 * upgrades. These are management/structure privileges that belong to the org
 * admin role only.
 */
export const ADMIN_ONLY_FEATURES: ReadonlySet<FeatureKey> = new Set<FeatureKey>([
  'org.manage',
  'member.manage',
  'role.builder',
]);

export interface FeatureResolution {
  /** Enabled feature keys, ordered by `FEATURES`. */
  features: FeatureKey[];
  /**
   * `X-Feature-Rollout` payload: the rollout percentage that was actually
   * applied for each enabled feature currently gated by a live rollout
   * (i.e. `rollout_percentage < 100`). Clients can expose this to users
   * (e.g. "you're in the 25% pilot of ai.chat").
   */
  rollout: Partial<Record<FeatureKey, number>>;
}

/**
 * Deterministic per-(key, user) rollout bucket in `0..99`. Stable across
 * requests (FNV-1a over `${key}:${userId}`), so a given user either always
 * sees a partially-rolled-out feature or never does — no flapping.
 */
export function rolloutBucket(userId: string, key: FeatureKey): number {
  let hash = 0x811c9dc5;
  const input = `${key}:${userId}`;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash % 100;
}
