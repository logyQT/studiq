/**
 * Canonical limit catalog — the single source of truth for limit keys and the
 * scope each one applies to (#233).
 *
 * Resolution rule (enforced by `limits.resolver.ts`):
 *
 * > In a verified org context the organization's plan governs every limit; a
 * > seat may raise only per-member (`scope: 'user'`) keys, never org-scope
 * > capacity; the personal plan applies only outside a verified org context; a
 * > missing `plan_limits` row is `0` (blocked) in every path.
 *
 * `user` keys are enforced against the caller's own content/usage; `org` keys
 * measure the whole organization and are only ever resolved from
 * `organizations.plan`.
 */
export type LimitScope = 'user' | 'org';

export const LIMITS = {
  max_flashcards: { scope: 'user' },
  max_decks: { scope: 'user' },
  max_questions: { scope: 'user' },
  max_question_banks: { scope: 'user' },
  max_quiz_attempts_per_day: { scope: 'user' },
  max_ai_tokens_per_day: { scope: 'user' },
  max_students: { scope: 'org' },
  max_groups: { scope: 'org' },
} as const satisfies Record<string, { scope: LimitScope }>;

export type LimitKey = keyof typeof LIMITS;

export const LIMIT_KEYS = Object.keys(LIMITS) as readonly LimitKey[];

const LIMIT_KEY_SET: ReadonlySet<string> = new Set<string>(LIMIT_KEYS);

export function isLimitKey(key: string): key is LimitKey {
  return LIMIT_KEY_SET.has(key);
}

export const USER_LIMIT_KEYS: readonly LimitKey[] = LIMIT_KEYS.filter(
  (key) => LIMITS[key].scope === 'user',
);

export const ORG_LIMIT_KEYS: readonly LimitKey[] = LIMIT_KEYS.filter(
  (key) => LIMITS[key].scope === 'org',
);
