import { registry, z } from '@studiq/server/lib/zod';

export const DailyStatsQuerySchema = registry.register(
  'AdminDailyStatsQuery',
  z.object({
    /** Window in days; the dashboard offers 30 and 90. */
    days: z.coerce.number().int().min(1).max(365).default(30),
  }),
);

export type DailyStatsQuery = z.infer<typeof DailyStatsQuerySchema>;

/** Answer of `GET /api/v1/stats`: the whole platform, every tenant together. */
export interface PlatformStats {
  users: {
    total: number;
    /** Soft-deleted accounts still inside their 30-day grace period. */
    deleted: number;
    newLast7Days: number;
    newLast30Days: number;
  };
  /** Users with a recorded review or quiz in the window (signing in alone does not count). */
  active: { last7Days: number; last30Days: number };
  organizations: number;
  groups: number;
  content: {
    decks: number;
    flashcards: number;
    questionBanks: number;
    questions: number;
    assignments: number;
    quizAttempts: number;
  };
  storage: { objects: number; bytes: number };
}

/** One UTC day of platform activity. */
export interface DailyStatsItem {
  date: string;
  registrations: number;
  quizAttempts: number;
  studySessions: number;
  reviews: number;
  activeUsers: number;
}

/** Answer of `GET /api/v1/stats/daily`: every day of the window is present, zeros included. */
export interface DailyStats {
  days: number;
  items: DailyStatsItem[];
}
