/** Quick picks next to the number field; `0` (off) is a separate button. */
export const GOAL_PRESETS = [10, 20, 50, 100] as const;

/** Same bound as the API (`MAX_DAILY_REVIEW_GOAL`). */
export const MAX_GOAL = 1000;

export interface GoalProgress {
  /** False when no goal is set (goal 0): there is nothing to measure against. */
  enabled: boolean;
  done: number;
  goal: number;
  remaining: number;
  /** 0-100, capped: doing more than the goal does not overflow the bar. */
  percent: number;
  reached: boolean;
}

/** Progress of today's reviews towards the daily goal. */
export function goalProgress(reviewedToday: number, goal: number): GoalProgress {
  const done = Math.max(0, Math.floor(reviewedToday));
  const target = Math.max(0, Math.floor(goal));
  if (target === 0) {
    return { enabled: false, done, goal: 0, remaining: 0, percent: 0, reached: false };
  }
  return {
    enabled: true,
    done,
    goal: target,
    remaining: Math.max(0, target - done),
    percent: Math.min(100, Math.round((done / target) * 100)),
    reached: done >= target,
  };
}

/**
 * Reads the goal field: digits only, 0 to MAX_GOAL. Anything else (empty, text, decimals,
 * negative, too big) is `null`, so the form can refuse it instead of guessing.
 */
export function parseGoalInput(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return value <= MAX_GOAL ? value : null;
}
