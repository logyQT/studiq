import type { PricingTranslator } from '@/lib/pricing-features';

export const SORTED_LIMIT_KEYS = [
  'max_flashcards',
  'max_decks',
  'max_questions',
  'max_question_banks',
  'max_quiz_attempts_per_day',
  'max_ai_tokens_per_day',
  'max_students',
  'max_groups',
];

/**
 * Limits that only make sense for organizations (seats and groups). No
 * personal plan carries them since #1193, so a personal comparison must not
 * show them even if a stray row appears.
 */
const ORG_ONLY_LIMIT_KEYS: readonly string[] = ['max_students', 'max_groups'];

/** Limit keys to render as comparison rows for the given plan scope. */
export function getVisibleLimitKeys(
  plans: ReadonlyArray<{ limits: Record<string, number> }> | undefined,
  scope: 'personal' | 'organization',
): string[] {
  return SORTED_LIMIT_KEYS.filter(
    (lk) =>
      !(scope === 'personal' && ORG_ONLY_LIMIT_KEYS.includes(lk)) &&
      plans?.some((p) => lk in p.limits),
  );
}

/**
 * Human readable label for a plan limit key such as `max_flashcards`.
 * next-intl returns the namespaced message id (`PricingPage.limit_…`) for a
 * missing message, so presence is checked with `t.has`; an unknown key falls
 * back to the key itself, never a raw message id.
 */
export function getLimitLabel(key: string, t: PricingTranslator): string {
  const messageKey = `limit_${key}`;
  return t.has(messageKey) ? t(messageKey) : key;
}
