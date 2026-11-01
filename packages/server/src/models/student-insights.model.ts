import { registry, z } from '@studiq/server/lib/zod';

export const StudentInsightsQuerySchema = registry.register(
  'StudentInsightsQuery',
  z.object({
    /** Window the insights cover, in days. */
    days: z.coerce.number().int().min(1).max(365).default(30),
  }),
);

export type StudentInsightsQuery = z.infer<typeof StudentInsightsQuerySchema>;

export interface StudyTimeInsight {
  /** Time in flashcard sessions plus time in finished quizzes, milliseconds. */
  totalMs: number;
  activeDays: number;
  /** `totalMs` over the days with any study; 0 without study. */
  avgMsPerActiveDay: number;
  /** Study time per UTC day, days without study are absent. */
  byDay: Array<{ date: string; ms: number }>;
  /** Index 0 = Monday ... 6 = Sunday. */
  byWeekday: number[];
}

/** Accuracy of the student on one topic; `null` when there is nothing to measure. */
export interface TopicMasteryItem {
  topicId: string;
  name: string;
  quizAnswers: number;
  /** 0-100 */
  quizAccuracy: number | null;
  flashcardReviews: number;
  /** 0-100 */
  flashcardAccuracy: number | null;
  /** Quiz answers and flashcard reviews together, 0-100. */
  accuracy: number;
}

export type RetentionBucketKey = 'd0' | 'd1' | 'd2_3' | 'd4_7' | 'd8_14' | 'd15_30' | 'd31_plus';

/** Reviews of a flashcard that came `bucket` days after its previous review. */
export interface RetentionBucket {
  bucket: RetentionBucketKey;
  reviews: number;
  /** 0-100; `null` without reviews in the bucket. */
  accuracy: number | null;
}

/** Answer of `GET /api/v1/stats/student/insights`. */
export interface StudentInsights {
  days: number;
  studyTime: StudyTimeInsight;
  mastery: TopicMasteryItem[];
  retention: RetentionBucket[];
}
