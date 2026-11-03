import { registry, z } from '@studiq/server/lib/zod';

export const TeacherFlashcardStatsQuerySchema = registry.register(
  'TeacherFlashcardStatsQuery',
  z.object({
    deckId: z.string().uuid().optional(),
    period: z.enum(['7d', '30d', 'all']).optional(),
  }),
);

export type TeacherFlashcardStatsQuery = z.infer<typeof TeacherFlashcardStatsQuerySchema>;

export const DeckStatsSchema = z.object({
  deckId: z.string(),
  deckName: z.string(),
  flashcardCount: z.number(),
  practiceCount: z.number(),
  correctCount: z.number(),
  accuracy: z.number(),
  avgEasinessFactor: z.number(),
});

export type DeckStats = z.infer<typeof DeckStatsSchema>;

export const TopicStatsSchema = z.object({
  topicId: z.string(),
  topicName: z.string(),
  flashcardCount: z.number(),
  practiceCount: z.number(),
  accuracy: z.number(),
});

export type TopicStats = z.infer<typeof TopicStatsSchema>;

export const DifficultyBreakdownSchema = z.object({
  easy: z.number(),
  medium: z.number(),
  hard: z.number(),
  new: z.number(),
});

export type DifficultyBreakdown = z.infer<typeof DifficultyBreakdownSchema>;

export const DifficultyCardsQuerySchema = registry.register(
  'DifficultyCardsQuery',
  z.object({
    deckIds: z.array(z.string().uuid()).optional(),
    topicIds: z.array(z.string().uuid()).optional(),
  }),
);
export type DifficultyCardsQuery = z.infer<typeof DifficultyCardsQuerySchema>;

export const DifficultyBucketSchema = registry.register(
  'DifficultyBucket',
  z.enum(['easy', 'medium', 'hard', 'new']),
);
export type DifficultyBucket = z.infer<typeof DifficultyBucketSchema>;

export type DifficultyFlashcardDetail = {
  id: string;
  front: string;
  back: string;
  accuracy: number;
  totalAttempts: number;
  studentCount: number;
  deckId: string;
  deckName: string;
  topicIds: string[];
  topicNames: string[];
};

/** Payload of `get_teacher_stats` (a `json` column from PostgREST's point of view). */
export const TeacherFlashcardStatsResponseSchema = z.object({
  summary: z.object({
    totalDecks: z.number(),
    totalFlashcards: z.number(),
    totalPractices: z.number(),
    practicingStudents: z.number(),
    rosterStudents: z.number().nullable(),
    overallAccuracy: z.number(),
    averageEasinessFactor: z.number(),
    difficultyBreakdown: DifficultyBreakdownSchema,
  }),
  byDeck: z.array(DeckStatsSchema).default([]),
  byTopic: z.array(TopicStatsSchema).default([]),
});

export type TeacherFlashcardStatsResponse = z.infer<typeof TeacherFlashcardStatsResponseSchema>;
