import type { DailyActivityItem } from '@studiq/server/models/stats.model';

/**
 * „Powtórki w tym tygodniu” / „Poprawne” are a fixed last-7-days metric: the
 * 7 dni / 30 dni / 1 rok switch only recalcs the chart (#383). Keep this window
 * in sync with the server's rolling `range=7d` boundary in
 * `stats.service.getActivity` (`now - 7 * 24h`).
 */
const WEEKLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Inclusive start (UTC `YYYY-MM-DD`) of the fixed weekly window. */
export function weeklyWindowStart(now: number = Date.now()): string {
  return new Date(now - WEEKLY_WINDOW_MS).toISOString().slice(0, 10);
}

export interface WeeklyActivity {
  reviews: number;
  correct: number;
}

/**
 * Sums only the last-7-days rows of an activity payload, whatever chart range it
 * was fetched for, so the weekly cards never follow the range selector (#383).
 */
export function summarizeWeeklyActivity(
  items: DailyActivityItem[] | undefined | null,
  now: number = Date.now(),
): WeeklyActivity {
  const start = weeklyWindowStart(now);
  let reviews = 0;
  let correct = 0;

  for (const day of items ?? []) {
    if (day.date < start) continue;
    reviews += day.reviews_count;
    correct += day.reviews_correct;
  }

  return { reviews, correct };
}
