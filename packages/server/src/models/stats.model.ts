import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { registry, z } from '@studiq/server/lib/zod';

export const TeacherStatsQuerySchema = registry.register(
  'TeacherStatsQuery',
  z.object({
    subjectId: z.string().uuid().optional(),
  }),
);

export type TeacherStatsQuery = z.infer<typeof TeacherStatsQuerySchema>;

/**
 * A question answered fewer times than this is not "a question to review": a single wrong answer
 * would read as a red 0 %. Applied once, in the service, so the dashboard card and the results
 * page agree.
 */
export const MIN_PROBLEM_QUESTION_ANSWERS = 3;

/** Per-question accuracy behind the „Problematyczne pytania” card (#204). */
/** One row of `get_teacher_problematic_questions` (a `json` column). */
export const ProblematicQuestionStatsSchema = z.object({
  id: z.string(),
  content: z.string(),
  type: z.string(),
  /** 0..1 fraction; the UI renders `Math.round(correctRate * 100)`. */
  correctRate: z.number(),
  /** Completed learner attempts that answered this question. */
  totalAnswers: z.number(),
});

export type ProblematicQuestionStats = z.infer<typeof ProblematicQuestionStatsSchema>;

/** The whole `get_teacher_problematic_questions` payload. */
export const ProblematicQuestionsSchema = z.array(ProblematicQuestionStatsSchema);

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

/** Query of the teacher dashboard blocks (#654). */
export const TeacherDashboardQuerySchema = registry.register(
  'TeacherDashboardQuery',
  z.object({
    /** Window of the per-group results, in days. */
    days: z.coerce
      .number({ error: ValidationErrorCode.NUMBER })
      .int({ error: ValidationErrorCode.INTEGER })
      .min(1, { error: ValidationErrorCode.TOO_SMALL })
      .max(365, { error: ValidationErrorCode.TOO_BIG })
      .default(30),
    /** Length of the activity feed. */
    limit: z.coerce
      .number({ error: ValidationErrorCode.NUMBER })
      .int({ error: ValidationErrorCode.INTEGER })
      .min(1, { error: ValidationErrorCode.TOO_SMALL })
      .max(50, { error: ValidationErrorCode.TOO_BIG })
      .default(10),
  }),
);

export type TeacherDashboardQuery = z.infer<typeof TeacherDashboardQuerySchema>;

/**
 * One group of the teacher on the dashboard: learners, completed attempts,
 * flashcard accuracy.
 */
export const TeacherGroupPerformanceItemSchema = z.object({
  groupId: z.string(),
  groupName: z.string(),
  /** Learners (`member` role) of the group, the teacher excluded. */
  students: z.number(),
  /** Completed quiz / assignment attempts of those learners inside the window. */
  completedAttempts: z.number(),
  /** Submitted assignment attempts still waiting for the teacher's grade; not in `avgScore`. */
  awaitingGrade: z.number(),
  /** Mean score of the GRADED attempts, 0–100; `null` without any ("no data" is not 0 %). */
  avgScore: z.number().nullable(),
  flashcardReviews: z.number(),
  /** Share of correct flashcard reviews, 0–100; `null` without reviews. */
  flashcardAccuracy: z.number().nullable(),
});

export type TeacherGroupPerformanceItem = z.infer<typeof TeacherGroupPerformanceItemSchema>;

/** Payload of `get_teacher_group_performance` (a `json` column). */
export const TeacherGroupPerformanceSchema = z.object({
  groups: z.array(TeacherGroupPerformanceItemSchema).default([]),
  totals: z.object({
    students: z.number(),
    completedAttempts: z.number(),
    awaitingGrade: z.number(),
  }),
});

/**
 * Per-group rows plus totals that count each learner and each attempt once. A learner in two
 * groups is one learner, so the totals are never the sum of the rows.
 */
export type TeacherGroupPerformance = z.infer<typeof TeacherGroupPerformanceSchema>;

export type TeacherFeedKind = 'quiz_completed' | 'assignment_submitted' | 'report_opened';

/** One line of the teacher dashboard's activity feed (a row of `get_teacher_activity_feed`). */
export const TeacherFeedItemSchema = z.object({
  kind: z.enum(['quiz_completed', 'assignment_submitted', 'report_opened']),
  at: z.string(),
  personName: z.string().nullable().default(null),
  /** Quiz / assignment title, or the beginning of the reported question. */
  title: z.string().nullable().default(null),
  scorePct: z.number().nullable().default(null),
  /** A submitted assignment still waiting for a grade. */
  needsGrading: z.boolean().default(false),
  assignmentId: z.string().nullable().default(null),
  questionId: z.string().nullable().default(null),
});

export type TeacherFeedItem = z.infer<typeof TeacherFeedItemSchema>;

/** The whole `get_teacher_activity_feed` payload. */
export const TeacherFeedSchema = z.array(TeacherFeedItemSchema);

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
