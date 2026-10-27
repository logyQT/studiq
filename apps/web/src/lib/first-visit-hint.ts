/** The pages that show a first-visit tip; each has a `hint_<id>` message in `EmptyStates`. */
export const FIRST_VISIT_HINTS = [
  'decks',
  'question_banks',
  'edu_assignments',
  'app_assignments',
] as const;

export type FirstVisitHintId = (typeof FIRST_VISIT_HINTS)[number];

/**
 * `localStorage` key under which the dismissal of a first-visit tip is remembered. It carries the
 * user id, so a second account on the same browser still sees its own first-visit tips (#135).
 */
export function hintStorageKey(id: FirstVisitHintId, userId: string): string {
  return `studiq:hint:${userId}:${id}`;
}
