import type { StudentActivityItem } from '@studiq/server/models/student-overview.model';

/** The `AppDashboard` message of one "recent activity" line. */
export type ActivityMessageKey =
  | 'activity_flashcards_studied'
  | 'activity_quiz_completed'
  | 'activity_quiz_completed_no_score'
  | 'activity_assignment_submitted'
  | 'activity_assignment_submitted_no_score'
  | 'activity_assignment_submitted_untitled'
  | 'activity_assignment_submitted_untitled_no_score';

/**
 * Where a line leads, if anywhere. A finished quiz opens its review. A submitted assignment opens
 * the review of that attempt, or its own page when the teacher withholds the results (the review
 * page has nothing to show then, #1142). A deleted assignment has no page left.
 */
export function activityHref(item: StudentActivityItem): string | null {
  if (!item.attemptId) return null;
  if (item.kind === 'quiz_completed') return `/app/study/session/quiz/${item.attemptId}/review`;
  if (item.kind !== 'assignment_submitted' || !item.assignmentId) return null;

  const assignment = `/app/assignments/${item.assignmentId}`;
  return item.resultsWithheld ? assignment : `${assignment}/review?attemptId=${item.attemptId}`;
}

/**
 * Which message a line reads. A withheld result has no percentage to quote, and a submitted
 * assignment whose title is gone (it was deleted, #1141) has no name to quote either, so it gets
 * its own wording instead of an invented "Untitled quiz".
 */
export function activityMessageKey(item: StudentActivityItem): ActivityMessageKey {
  if (item.kind === 'flashcards_studied') return 'activity_flashcards_studied';
  const noScore = item.scorePct === null;
  if (item.kind === 'quiz_completed') {
    return noScore ? 'activity_quiz_completed_no_score' : 'activity_quiz_completed';
  }
  if (item.title === null) {
    return noScore
      ? 'activity_assignment_submitted_untitled_no_score'
      : 'activity_assignment_submitted_untitled';
  }
  return noScore ? 'activity_assignment_submitted_no_score' : 'activity_assignment_submitted';
}
