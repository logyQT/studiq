export interface NavigableAttempt {
  id: string;
  completed_at: string | null;
  /** Nothing left for a teacher to grade (#1069). */
  graded: boolean;
}

export interface AttemptNavigation {
  /** From 1, in the order of the results table. An unsubmitted attempt is not counted. */
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

/**
 * Where `currentId` stands among the submitted attempts, or null when it is not one of the
 * attempts (#1354). An attempt that is still running has nothing to grade yet, so the moves
 * skip it. The current one always counts: the results table can open a running attempt.
 */
export function attemptNavigation(
  attempts: readonly NavigableAttempt[],
  currentId: string,
): AttemptNavigation | null {
  const sheets = attempts.filter(
    (attempt) => attempt.completed_at !== null || attempt.id === currentId,
  );
  const index = sheets.findIndex((attempt) => attempt.id === currentId);
  if (index < 0) return null;

  // Every other sheet, starting after this one and wrapping round.
  const others = [...sheets.slice(index + 1), ...sheets.slice(0, index)];

  return {
    position: index + 1,
    total: sheets.length,
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

const GRADING_SHORTCUTS: readonly GradingShortcut[] = ['previous', 'next', 'nextUngraded'];

/**
 * The grading shortcut a pressed key stands for, if any. It reads the map that the key lists
 * show, so a list cannot name a key the page does not take.
 */
export function gradingShortcut(key: string): GradingShortcut | null {
  const pressed = key.toLowerCase();
  return (
    GRADING_SHORTCUTS.find((name) => GRADING_SHORTCUT_KEYS[name].toLowerCase() === pressed) ?? null
  );
}

/** The grading page of one attempt. The per-question page has one segment more. */
export function isGradingSheetPath(pathname: string | null | undefined): boolean {
  return /^\/edu\/assignments\/[^/]+\/results\/[^/]+$/.test(pathname ?? '');
}
