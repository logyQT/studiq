import { registry, z } from '@studiq/server/lib/zod';

export const TeacherStatsQuerySchema = registry.register(
  'TeacherStatsQuery',
  z.object({
    subjectId: z.string().uuid().optional(),
  }),
);

export type TeacherStatsQuery = z.infer<typeof TeacherStatsQuerySchema>;

/** Per-question accuracy behind the „Problematyczne pytania” card (#204). */
export interface ProblematicQuestionStats {
  id: string;
  content: string;
  type: string;
  /** 0..1 fraction; the UI renders `Math.round(correctRate * 100)`. */
  correctRate: number;
  /** Completed learner attempts that answered this question. */
  totalAnswers: number;
}

/**
 * A "subject" in the content statistics is a `question_banks` row: the legacy
 * `subjects` table was dropped in favour of question banks, and the seeded
 * Classroom banks are named after school subjects (Historia, Geografia i Nauka).
 */
export type TeacherStatsResponse = {
  totalQuestions: number;
  totalFlashcards: number;
  /** Type split of all questions, or of the selected subject when filtered. */
  subject: {
    byType: Record<string, number>;
    /**
     * Questions answered correctly in fewer than half of the completed learner
     * attempts, worst first. `open` questions are excluded until they are
     * teacher-graded. Always an array — empty means nothing to flag.
     */
    problematicQuestions: ProblematicQuestionStats[];
  };
  /** Global distribution across question banks; never narrowed by `subjectId`. */
  bySubject: Array<{
    subjectId: string;
    subjectName: string | null;
    questionCount: number;
  }>;
};

export type StudentStatsResponse = {
  totalQuizzes: number;
  /**
   * Mean of the per-attempt scores over attempts that have a gradable
   * denominator: assignment attempts against `total_points` (teacher-graded),
   * practice quizzes against their closed-question count (#329/#619).
   * `null` = nothing was gradable yet, so the UI shows `—` instead of a
   * fabricated 0 %.
   */
  avgScore: number | null;
  /** Highest per-attempt percentage on the same basis as `avgScore`; `null` when none is gradable. */
  bestScore: number | null;
  totalQuestionsCreated: number;
  flashcardsPracticed: number;
  flashcardAccuracy: number;
  /** Only attempts with a gradable denominator; `total` is that denominator. */
  attemptsOverTime: {
    date: string;
    score: number;
    total: number;
    percentage: number;
  }[];
};

export interface DailyActivityItem {
  date: string;
  reviews_count: number;
  reviews_correct: number;
  quizzes_count: number;
  quizzes_score: number;
  quizzes_total: number;
}

export interface ActivityResponse {
  items: DailyActivityItem[];
  dailyReviewGoal: number;
}

export interface TeacherQuizStatsItem {
  id: string;
  /**
   * Display name: the attempt's stored `config.title`, else the quiz the
   * assignment was built from, else the assignment title. `null` when none of
   * those exist — the clients render a localized „untitled quiz” label.
   */
  title: string | null;
  /** Attempts started (a row exists as soon as a student opens the quiz). */
  totalAttempts: number;
  /** Mean of the per-attempt scores normalised to their own max (points or question count) over completed attempts, 0–100. */
  avgScore: number;
  /** Completed / started attempts as an integer percent, 0–100. */
  avgCompletionRate: number;
}

export interface WeakDeckItem {
  deckId: string;
  name: string;
  accuracy: number;
  totalAttempts: number;
}

export interface WeakTopicItem {
  topicId: string;
  name: string;
  accuracy: number;
  totalAttempts: number;
}

export interface WeakPointsResponse {
  weakDecks: WeakDeckItem[];
  weakTopics: WeakTopicItem[];
}

export type WeakItem = Pick<WeakDeckItem, 'name' | 'accuracy' | 'totalAttempts'>;
