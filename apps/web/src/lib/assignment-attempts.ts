/**
 * Attempt-budget derivation shared by the student assignment list and detail
 * pages. The server owns the counting rule (`attempts_used` counts completed
 * attempts only, matching `startAttempt`); the client only renders it.
 */

export interface AttemptSummary {
  id: string;
  score: number;
  total_questions: number;
  total_points: number | null;
  completed_at: string | null;
  started_at: string;
}

export interface StudentAssignmentAttemptState {
  max_attempts: number;
  attempts_used: number;
  attempt: AttemptSummary | null;
  last_completed_attempt: AttemptSummary | null;
}

/** The running attempt, if any — a completed attempt is not resumable. */
export function openAttempt(a: StudentAssignmentAttemptState): AttemptSummary | null {
  return a.attempt && a.attempt.completed_at === null ? a.attempt : null;
}

/** Remaining attempts, clamped: a teacher may lower max_attempts below the used count. */
export function attemptsLeft(a: StudentAssignmentAttemptState): number {
  return Math.max(0, a.max_attempts - a.attempts_used);
}

/** Server truth for “another attempt may be started?” (deadline/window handled by caller). */
export function hasAttemptsLeft(a: StudentAssignmentAttemptState): boolean {
  return attemptsLeft(a) > 0;
}

/**
 * Review page: an explicit `?attemptId=` always wins (older attempts stay
 * linkable); otherwise use the latest submitted attempt — the same row the
 * detail page's „Zobacz podsumowanie” link points at.
 */
export function reviewAttemptId(
  requestedAttemptId: string | null | undefined,
  assignment: StudentAssignmentAttemptState | null | undefined,
): string | null {
  return requestedAttemptId || assignment?.last_completed_attempt?.id || null;
}
