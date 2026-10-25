import type { DailyActivityItem, TeacherStatsResponse } from '@studiq/server/models/stats.model';

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

/**
 * Question types shown first in the content-stats breakdown, in product order.
 * The enum has more values (`multi_select`, `matching`, …); any type seen in the
 * data but missing here is appended afterwards.
 */
const QUESTION_TYPE_ORDER = ['mcq', 'true_false', 'open'] as const;

/**
 * Stable `[type, count]` ordering for the „Pytania według typu” card, so the
 * rows do not reshuffle between the global view and a filtered subject.
 */
export function orderedQuestionTypeEntries(byType: Record<string, number>): Array<{
  key: string;
  count: number;
}> {
  const known: readonly string[] = QUESTION_TYPE_ORDER;
  const ordered = [
    ...QUESTION_TYPE_ORDER.filter((key) => byType[key] !== undefined),
    ...Object.keys(byType)
      .filter((key) => !known.includes(key))
      .sort((a, b) => a.localeCompare(b)),
  ];

  return ordered.map((key) => ({ key, count: byType[key] }));
}

/** Payload the content-stats page needs; aliases the API contract. */
export type TeacherStatsPayload = TeacherStatsResponse;

/**
 * Unwraps `{ success: true, data }` from the stats API and rejects error envelopes
 * (`{ success: false, error }`) and payloads the page cannot render. Returns null so
 * callers can keep their last good payload instead of putting an error body in state.
 */
export function parseTeacherStatsResponse(body: unknown): TeacherStatsPayload | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;

  const envelope = body as { success?: unknown; data?: unknown };
  if (envelope.success === false) return null;

  // Keeps the old `data ?? body` behaviour for an unwrapped payload.
  const candidate = 'data' in envelope ? envelope.data : body;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;

  const payload = candidate as Partial<TeacherStatsPayload>;
  const byType = payload.subject?.byType;
  if (
    typeof payload.totalQuestions !== 'number' ||
    typeof payload.totalFlashcards !== 'number' ||
    !byType ||
    typeof byType !== 'object' ||
    Array.isArray(byType) ||
    !Array.isArray(payload.bySubject)
  ) {
    return null;
  }

  return payload as TeacherStatsPayload;
}

export interface AttemptScore {
  score: number;
  total_questions: number;
  total_points?: number | null;
}

/**
 * One percentage per quiz attempt, on the same basis as `stats.service` (#321):
 * assignment attempts are scored against `total_points`, practice quizzes
 * against the question count. `Math.max(..., 1)` keeps a 0-question attempt
 * from producing `NaN`/`Infinity`.
 */
export function attemptPercentage(attempt: AttemptScore): number {
  const total = Math.max(attempt.total_points ?? attempt.total_questions, 1);
  return Math.round((attempt.score / total) * 100);
}

/** Structural subset of the teacher activity payload needed to detect an empty period. */
export interface TeacherActivityPayload {
  summary: {
    totalPractices: { current: number };
    totalQuizzes: { current: number };
  };
  dailyActivity: { reviews: number }[];
  students: { practices7d: number; quizzes7d: number }[];
}

/**
 * The activity API always returns every org member, so array lengths say
 * nothing. True only when some raw learning counter is non-zero (derived fields
 * such as accuracy or status are ignored) (#209).
 *
 * `activeStudents` (summary and daily) is deliberately excluded: the server
 * derives it from any `user_daily_activity` row, and that table also holds
 * AI-token accounting rows, so AI-only use would look like learning activity.
 */
export function hasTeacherActivity(data: TeacherActivityPayload): boolean {
  const { summary } = data;
  return (
    summary.totalPractices.current > 0 ||
    summary.totalQuizzes.current > 0 ||
    data.dailyActivity.some((d) => d.reviews > 0) ||
    data.students.some((s) => s.practices7d > 0 || s.quizzes7d > 0)
  );
}
