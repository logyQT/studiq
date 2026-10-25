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
 * Limits that only make sense for educators/organizations (seats and groups).
 * They are never enforced for a student's personal plan, so the student plan
 * comparison must not show them (the free plan would read as "unlimited").
 */
export const ORG_ONLY_LIMIT_KEYS: readonly string[] = ['max_students', 'max_groups'];

/** Limit keys to render as comparison rows for the given audience. */
export function getVisibleLimitKeys(
  plans: ReadonlyArray<{ limits: Record<string, number> }> | undefined,
  accountType: string,
): string[] {
  return SORTED_LIMIT_KEYS.filter(
    (lk) =>
      !(accountType === 'student' && ORG_ONLY_LIMIT_KEYS.includes(lk)) &&
      plans?.some((p) => lk in p.limits),
  );
}
