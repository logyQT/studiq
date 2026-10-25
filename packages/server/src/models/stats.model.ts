import { registry, z } from '@studiq/server/lib/zod';

export const TeacherStatsQuerySchema = registry.register(
  'TeacherStatsQuery',
  z.object({
    subjectId: z.string().uuid().optional(),
  }),
);

export type TeacherStatsQuery = z.infer<typeof TeacherStatsQuerySchema>;

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
  avgScore: number;
  bestScore: number;
  totalQuestionsCreated: number;
  flashcardsPracticed: number;
  flashcardAccuracy: number;
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
  /** null when the quiz has no title in its config. */
  title: string | null;
  totalAttempts: number;
  /** Mean of the per-attempt scores normalised to their own max (points or question count), 0–100. */
  avgScore: number;
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
