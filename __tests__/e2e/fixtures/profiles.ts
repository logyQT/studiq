/**
 * Which fixture graph a spec's tenant gets.
 *
 * `bare` is the default: org + teacher + student + one group. Specs that create
 * their own decks/banks/quizzes should stay on it so "empty state" assertions
 * stay honest.
 *
 * `content` adds the read-only graph: two decks (20 cards), two banks (10
 * questions with options), a quiz and a published assignment targeting the group.
 */
export type SeedProfile = 'bare' | 'content';

/** Specs that read pre-existing content instead of creating it. */
export const PROFILE_BY_FILE: Record<string, SeedProfile> = {
  'flashcard-detail.spec.ts': 'content',
  'flashcard-selection.spec.ts': 'content',
  'flashcard-topics.spec.ts': 'content',
  'question-bank-crud.spec.ts': 'content',
  'teacher-flashcard.spec.ts': 'content',
};

export function profileFor(file: string): SeedProfile {
  return PROFILE_BY_FILE[file.split('/').pop() ?? ''] ?? 'bare';
}
