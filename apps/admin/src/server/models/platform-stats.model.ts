import { registry, z } from '@studiq/server/lib/zod';

export const DailyStatsQuerySchema = registry.register(
  'AdminDailyStatsQuery',
  z.object({
    /** Window in days; the dashboard offers 30 and 90. */
    days: z.coerce.number().int().min(1).max(365).default(30),
  }),
);

export type DailyStatsQuery = z.infer<typeof DailyStatsQuerySchema>;

/** Shape of the `admin_platform_stats()` jsonb payload; also validates it. */
export const PlatformStatsSchema = z.object({
  users: z.object({
    total: z.number(),
    /** Soft-deleted accounts still inside their 30-day grace period. */
    deleted: z.number(),
    newLast7Days: z.number(),
    newLast30Days: z.number(),
  }),
  /** Users with a recorded review or quiz in the window (signing in alone does not count). */
  active: z.object({ last7Days: z.number(), last30Days: z.number() }),
  organizations: z.number(),
  groups: z.number(),
  content: z.object({
    decks: z.number(),
    flashcards: z.number(),
    questionBanks: z.number(),
    questions: z.number(),
    assignments: z.number(),
    quizAttempts: z.number(),
  }),
  storage: z.object({ objects: z.number(), bytes: z.number() }),
});

/** Answer of `GET /api/v1/stats`: the whole platform, every tenant together. */
export type PlatformStats = z.infer<typeof PlatformStatsSchema>;

/** One UTC day of platform activity. */
export const DailyStatsItemSchema = z.object({
  date: z.string(),
  registrations: z.number(),
  quizAttempts: z.number(),
  studySessions: z.number(),
  reviews: z.number(),
  activeUsers: z.number(),
});

export type DailyStatsItem = z.infer<typeof DailyStatsItemSchema>;

/** Shape of the `admin_daily_stats()` jsonb payload; also validates it. */
export const DailyStatsSchema = z.object({
  days: z.number(),
  items: z.array(DailyStatsItemSchema),
});

/** Answer of `GET /api/v1/stats/daily`: every day of the window is present, zeros included. */
export type DailyStats = z.infer<typeof DailyStatsSchema>;
