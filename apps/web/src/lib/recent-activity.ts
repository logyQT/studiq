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
