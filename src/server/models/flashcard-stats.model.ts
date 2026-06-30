import { registry, z } from '@/lib/zod';

export const TeacherFlashcardStatsQuerySchema = registry.register(
  'TeacherFlashcardStatsQuery',
  z.object({
    deckId: z.string().uuid().optional(),
    period: z.enum(['7d', '30d', 'all']).optional(),
  }),
);

export type TeacherFlashcardStatsQuery = z.infer<typeof TeacherFlashcardStatsQuerySchema>;

export type DeckStats = {
  deckId: string;
  deckName: string;
  flashcardCount: number;
  practiceCount: number;
  correctCount: number;
  accuracy: number;
  avgEasinessFactor: number;
};

export type TopicStats = {
  topicId: string;
  topicName: string;
  flashcardCount: number;
  practiceCount: number;
  accuracy: number;
};

export type DifficultyBreakdown = {
  easy: number;
  medium: number;
  hard: number;
  new: number;
};

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
  deckIds: string[];
  deckNames: string[];
  topicIds: string[];
  topicNames: string[];
};

export type TeacherFlashcardStatsResponse = {
  summary: {
    totalDecks: number;
    totalFlashcards: number;
    totalPractices: number;
    totalStudents: number;
    overallAccuracy: number;
    averageEasinessFactor: number;
    difficultyBreakdown: DifficultyBreakdown;
  };
  byDeck: DeckStats[];
  byTopic: TopicStats[];
};
