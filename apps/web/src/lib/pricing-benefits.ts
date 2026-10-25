/**
 * Deterministic ordering for plan feature keys.
 *
 * PostgREST returns `plan_features` unordered, so rendering `plan.features`
 * as-is makes the checkout bullets shuffle between loads. The explicit
 * priority list puts the differentiators first; unknown keys are appended
 * alphabetically so a newly seeded feature still renders in a stable place.
 */
export const FEATURE_PRIORITY: readonly string[] = [
  'ai.chat',
  'quiz.builder',
  'advanced.stats',
  'documents',
  'role.builder',
  'branding',
  'group.manage',
  'member.manage',
  'flashcards',
  'quiz',
];

/** De-duped, priority-first then alphabetical for unknown keys. */
export function sortFeaturesByPriority(features: readonly string[]): string[] {
  const unique = [...new Set(features)];
  const known = FEATURE_PRIORITY.filter((key) => unique.includes(key));
  const unknown = unique
    .filter((key) => !FEATURE_PRIORITY.includes(key))
    .sort((a, b) => a.localeCompare(b));
  return [...known, ...unknown];
}

/** Ordered feature keys, capped at `max` (short lists are not padded). */
export function getHighlightedFeatures(features: readonly string[], max = 5): string[] {
  return sortFeaturesByPriority(features).slice(0, max);
}
