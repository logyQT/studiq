export interface DueProgress {
  /** Reviews already done today. */
  done: number;
  /** Reviews still due. */
  remaining: number;
  /** Done plus still due: the day's workload so far. */
  total: number;
  /** 0-100, rounded; 100 when everything is done. */
  percent: number;
}

/**
 * Progress of today's flashcard reviews. Cards reviewed today are no longer due, so the
 * workload of the day is `reviewed + due`; with nothing in either there is no bar to show.
 * Negative or fractional inputs (a stale cache, a mid-review refetch) are clamped.
 */
export function dueProgress(reviewedToday: number, dueNow: number): DueProgress {
  const done = Math.max(0, Math.floor(reviewedToday));
  const remaining = Math.max(0, Math.floor(dueNow));
  const total = done + remaining;
  return {
    done,
    remaining,
    total,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
  };
}
