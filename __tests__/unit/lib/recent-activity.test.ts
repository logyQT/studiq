import type { StudentActivityItem } from '@studiq/server/models/student-overview.model';
import { describe, expect, it } from 'vitest';
import en from '@/i18n/messages/en.json';
import pl from '@/i18n/messages/pl.json';
import { activityHref, activityMessageKey } from '@/lib/recent-activity';

// #1141: the "recent activity" line of a submitted assignment whose title is gone (the assignment
// was deleted) must not quote "Untitled quiz"; it has wording of its own, in both locales.

const base = {
  at: '2026-10-27T10:00:00Z',
  cardsStudied: null,
  attemptId: 'a-1',
  assignmentId: null,
  resultsWithheld: false,
} as const;

function item(
  kind: StudentActivityItem['kind'],
  title: string | null,
  scorePct: number | null,
): StudentActivityItem {
  return { ...base, kind, title, scorePct };
}

describe('activityMessageKey', () => {
  it.each([
    ['flashcards_studied', null, null, 'activity_flashcards_studied'],
    ['quiz_completed', 'Quiz A', 80, 'activity_quiz_completed'],
    ['quiz_completed', 'Quiz A', null, 'activity_quiz_completed_no_score'],
    ['assignment_submitted', 'Kartkówka', 70, 'activity_assignment_submitted'],
    ['assignment_submitted', 'Kartkówka', null, 'activity_assignment_submitted_no_score'],
    ['assignment_submitted', null, 70, 'activity_assignment_submitted_untitled'],
    ['assignment_submitted', null, null, 'activity_assignment_submitted_untitled_no_score'],
  ] as const)('%s titled %s with %s reads %s', (kind, title, scorePct, expected) => {
    expect(activityMessageKey(item(kind, title, scorePct))).toBe(expected);
  });

  it('keeps a practice quiz without a title on the quiz wording', () => {
    expect(activityMessageKey(item('quiz_completed', null, 80))).toBe('activity_quiz_completed');
  });

  it.each([
    ['en', en.AppDashboard],
    ['pl', pl.AppDashboard],
  ] as const)('%s has copy for the untitled assignment lines, with no quoted title', (_l, copy) => {
    const untitled = [
      copy.activity_assignment_submitted_untitled,
      copy.activity_assignment_submitted_untitled_no_score,
    ];

    for (const message of untitled) {
      expect(message).toBeTypeOf('string');
      expect(message).not.toContain('{title}');
    }
    expect(copy.activity_assignment_submitted_untitled).toContain('{score}');
  });
});

const href = (
  kind: StudentActivityItem['kind'],
  over: Partial<StudentActivityItem> = {},
): string | null => activityHref({ ...item(kind, 'Title', null), ...over });

// #1142: where a line leads. The quiz review has no state for withheld results, so a
// submitted assignment never goes there.
describe('activityHref', () => {
  it('leads a completed quiz to its own review', () => {
    expect(href('quiz_completed')).toBe('/app/study/session/quiz/a-1/review');
  });

  it('leads a submitted assignment with visible results to the review of that attempt', () => {
    expect(href('assignment_submitted', { assignmentId: 'as-1' })).toBe(
      '/app/assignments/as-1/review?attemptId=a-1',
    );
  });

  it('leads a submitted assignment with withheld results to the assignment page', () => {
    expect(href('assignment_submitted', { assignmentId: 'as-1', resultsWithheld: true })).toBe(
      '/app/assignments/as-1',
    );
  });

  it('leads nowhere once the assignment is deleted', () => {
    expect(href('assignment_submitted', { assignmentId: null, resultsWithheld: true })).toBeNull();
  });

  it('leads a flashcard session nowhere', () => {
    expect(href('flashcards_studied', { attemptId: null })).toBeNull();
  });
});
