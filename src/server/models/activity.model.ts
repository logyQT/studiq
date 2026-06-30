import { ValidationErrorCode } from '@/lib/validation-errors';
import { registry, z } from '@/lib/zod';

export const ActivityQuerySchema = registry.register(
  'ActivityQuery',
  z.object({
    range: z.enum(['7d', '30d', '90d'], { error: ValidationErrorCode.INVALID_INPUT }).default('7d'),
  }),
);

export type ActivityQuery = z.infer<typeof ActivityQuerySchema>;

export type StudentActivityRow = {
  id: string;
  name: string | null;
  email: string;
  lastActive: string | null;
  practices7d: number;
  accuracy7d: number | null;
  quizzes7d: number;
  status: 'active' | 'recent' | 'check_in';
};

export type DailyActivityPoint = {
  date: string;
  reviews: number;
  activeStudents: number;
};

export type QuizActivityItem = {
  difficulty: string;
  attempts: number;
  avgScore: number;
};

export type MetricComparison = {
  current: number;
  previous: number;
};

export type ActivitySummary = {
  activeStudents: MetricComparison;
  totalPractices: MetricComparison;
  avgAccuracy: MetricComparison;
  totalQuizzes: MetricComparison;
};

export type ClassActivityResponse = {
  summary: ActivitySummary;
  dailyActivity: DailyActivityPoint[];
  students: StudentActivityRow[];
  quizzes: QuizActivityItem[];
};
