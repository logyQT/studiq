/**
 * Attempt-budget derivation shared by the student assignment list and detail
 * pages. The server owns the counting rule (`attempts_used` counts completed
 * attempts only, matching `startAttempt`); the client only renders it.
 */

export interface AttemptSummary {
  id: string;
  /** `null` = results withheld by the assignment's „Pokaż wyniki” switch. */
  score: number | null;
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

/** The window fields needed to bucket a student assignment by time. */
export interface StudentAssignmentTiming {
  start_time: string | null;
  deadline: string | null;
}

export interface StudentAssignmentBuckets<T> {
  scheduled: T[];
  pending: T[];
  inProgress: T[];
  closed: T[];
  completed: T[];
}

/**
 * Buckets the student assignment list (#368). Precedence mirrors the page's
 * pre-#368 filters and only carves in-progress rows out of `pending`:
 * scheduled → closed → completed → inProgress → pending.
 *
 * `scheduled`/`closed`/`completed` stay mutually exclusive; an open attempt is
 * considered only for rows that still have attempts left and are inside their
 * window — an attempt past the deadline is not resumable, so it stays closed.
 */
export function groupStudentAssignments<
  T extends StudentAssignmentAttemptState & StudentAssignmentTiming,
>(assignments: readonly T[], now: Date): StudentAssignmentBuckets<T> {
  const buckets: StudentAssignmentBuckets<T> = {
    scheduled: [],
    pending: [],
    inProgress: [],
    closed: [],
    completed: [],
  };

  for (const a of assignments) {
    const canAttempt = hasAttemptsLeft(a);

    if (canAttempt && a.start_time && now < new Date(a.start_time)) {
      buckets.scheduled.push(a);
    } else if (canAttempt && a.deadline && now > new Date(a.deadline)) {
      buckets.closed.push(a);
    } else if (!canAttempt) {
      buckets.completed.push(a);
    } else if (openAttempt(a)) {
      buckets.inProgress.push(a);
    } else {
      buckets.pending.push(a);
    }
  }

  return buckets;
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
