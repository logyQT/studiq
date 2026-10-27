import type {
  RetentionBucket,
  TopicMasteryItem,
} from '@studiq/server/models/student-insights.model';

const MINUTE_MS = 60 * 1000;

/** Whole hours and the remaining minutes, rounded to the nearest minute. */
export function splitDuration(ms: number): { hours: number; minutes: number } {
  const totalMinutes = Math.max(0, Math.round(ms / MINUTE_MS));
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}

/** Index (0 = Monday) of the weekday with the most study time; `null` without any study. */
export function busiestWeekday(byWeekday: readonly number[]): number | null {
  let best: number | null = null;
  let bestMs = 0;
  byWeekday.forEach((ms, index) => {
    if (ms > bestMs) {
      best = index;
      bestMs = ms;
    }
  });
  return best;
}

/** Localized short weekday names, Monday first (2024-01-01 was a Monday). */
export function weekdayNames(locale: string, width: 'short' | 'long' = 'short'): string[] {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: width, timeZone: 'UTC' });
  return Array.from({ length: 7 }, (_, i) => formatter.format(new Date(Date.UTC(2024, 0, 1 + i))));
}

/** Reviews per bucket below this are too few to read a trend from. */
export const MIN_BUCKET_REVIEWS = 5;

/** Total reviews the retention curve is based on. */
export function retentionSample(buckets: readonly RetentionBucket[]): number {
  return buckets.reduce((sum, b) => sum + b.reviews, 0);
}

/**
 * Topic mastery sorted for display: the topics practised most come first. The server already
 * orders by volume; this keeps the order stable for equal volumes and drops topics without any
 * activity, so a list is never padded with empty rows.
 */
export function visibleMastery(items: readonly TopicMasteryItem[], limit = 10): TopicMasteryItem[] {
  return items
    .filter((item) => item.quizAnswers + item.flashcardReviews > 0)
    .sort(
      (a, b) =>
        b.quizAnswers + b.flashcardReviews - (a.quizAnswers + a.flashcardReviews) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, limit);
}

/** Colour band of a mastery bar: below 50 % needs work, from 80 % is solid. */
export function masteryLevel(accuracy: number): 'low' | 'medium' | 'high' {
  if (accuracy >= 80) return 'high';
  if (accuracy >= 50) return 'medium';
  return 'low';
}
