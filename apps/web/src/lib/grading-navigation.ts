export interface NavigableAttempt {
  id: string;
  completed_at: string | null;
  /** Nothing left for a teacher to grade (#1069). */
  graded: boolean;
}

export interface AttemptNavigation {
  /** From 1, in the order of the results table. */
  position: number;
  total: number;
  /** Both wrap at the ends; null when there is no other attempt. */
  previousId: string | null;
  nextId: string | null;
  /** The next submitted attempt, after this one, that still has something to grade. */
  nextUngradedId: string | null;
  /** Submitted attempts that still have something to grade, this one included. */
  leftToGrade: number;
}

const needsGrade = (attempt: NavigableAttempt): boolean =>
  attempt.completed_at !== null && !attempt.graded;

/** Where `currentId` stands among the attempts, or null when it is not one of them (#1354). */
export function attemptNavigation(
  attempts: readonly NavigableAttempt[],
  currentId: string,
): AttemptNavigation | null {
  const index = attempts.findIndex((attempt) => attempt.id === currentId);
  if (index < 0) return null;

  // Every other attempt, starting after this one and wrapping round.
  const others = [...attempts.slice(index + 1), ...attempts.slice(0, index)];

  return {
    position: index + 1,
    total: attempts.length,
    previousId: others.at(-1)?.id ?? null,
    nextId: others[0]?.id ?? null,
    nextUngradedId: others.find(needsGrade)?.id ?? null,
    leftToGrade: attempts.filter(needsGrade).length,
  };
}

export type GradingShortcut = 'previous' | 'next' | 'nextUngraded';

export const GRADING_SHORTCUT_KEYS: Record<GradingShortcut, string> = {
  previous: '[',
  next: ']',
  nextUngraded: 'N',
};

/** The grading shortcut a pressed key stands for, if any. */
export function gradingShortcut(key: string): GradingShortcut | null {
  if (key === '[') return 'previous';
  if (key === ']') return 'next';
  return key.toLowerCase() === 'n' ? 'nextUngraded' : null;
}
