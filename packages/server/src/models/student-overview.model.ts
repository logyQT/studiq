/** A practice quiz the student started and has not finished. */
export interface ResumeQuiz {
  attemptId: string;
  title: string | null;
  answered: number;
  total: number;
  startedAt: string;
}

/** The deck of the student's most recent study session. */
export interface ResumeDeck {
  deckId: string;
  name: string;
  lastStudiedAt: string;
}

export type StudentActivityKind = 'flashcards_studied' | 'quiz_completed' | 'assignment_submitted';

/** One line of the student's recent activity timeline. */
export interface StudentActivityItem {
  kind: StudentActivityKind;
  at: string;
  /** Quiz / assignment title. */
  title: string | null;
  /** Cards studied in a flashcard session. */
  cardsStudied: number | null;
  /** 0-100; `null` when the teacher withholds the result of an assignment. */
  scorePct: number | null;
  /** The finished quiz or assignment attempt behind the line. */
  attemptId: string | null;
  /**
   * The assignment of a submitted attempt, only while its status is `published`. The value is
   * `null` for a cancelled, draft or deleted assignment, and for each other kind of line.
   */
  assignmentId: string | null;
  /** `true` when the student can open the review of this assignment now. */
  reviewUnlocked: boolean;
}

/** Answer of `GET /api/v1/stats/student/overview` (the personalised part of the /app dashboard). */
export interface StudentOverview {
  resume: {
    quiz: ResumeQuiz | null;
    deck: ResumeDeck | null;
  };
  /** Flashcard reviews done today; with `dueToday` of the student stats it gives the progress bar. */
  reviewedToday: number;
  activity: StudentActivityItem[];
}
