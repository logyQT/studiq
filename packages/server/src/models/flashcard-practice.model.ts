import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { registry, z } from '@studiq/server/lib/zod';
import type { IntervalUnit } from './flashcard-spaced-repetition.model';

export const ReviewStateSchema = registry.register(
  'ReviewState',
  z.object({
    easinessFactor: z.number(),
    intervalValue: z.number(),
    intervalUnit: z.enum(['minutes', 'days']),
    repetitions: z.number(),
    nextReviewAt: z.string(),
    lastReviewedAt: z.string().nullable(),
    lastQuality: z.number().nullable(),
    learningState: z.enum(['new', 'learning', 'review', 'relearning']),
    learningStep: z.number().int(),
    lapseCount: z.number().int(),
    isLeech: z.boolean(),
  }),
);

export const PracticeCardSchema = registry.register(
  'PracticeCard',
  z.object({
    id: z.string().uuid(),
    front: z.string(),
    back: z.string(),
    createdAt: z.string().nullable(),
    deckName: z.string().nullable(),
    topicNames: z.array(z.string()),
    reviewState: ReviewStateSchema.nullable(),
  }),
);

export const PreparePracticeSchema = registry.register(
  'PreparePracticeRequest',
  z.object({
    deckIds: z.array(z.string().uuid()).optional(),
    topicIds: z.array(z.string().uuid()).optional(),
  }),
);

/**
 * Request-level study mode (#617). Cram is side-effect-free, so the service has
 * to be told the mode instead of inferring it from the client's UI state.
 * Omitted → `'review'`, which keeps every pre-#617 caller byte-compatible.
 */
const PracticeModeSchema = z
  .enum(['review', 'cram'], { error: ValidationErrorCode.INVALID_INPUT })
  .default('review');

export const LogPracticeSchema = registry.register(
  'LogFlashcardPracticeRequest',
  z.object({
    wasCorrect: z.boolean({ error: ValidationErrorCode.REQUIRED }),
    responseTimeMs: z
      .number({ error: ValidationErrorCode.NUMBER })
      .int({ error: ValidationErrorCode.INTEGER })
      .positive({ error: ValidationErrorCode.POSITIVE_NUMBER })
      .optional(),
    confidenceLevel: z
      .number({ error: ValidationErrorCode.NUMBER })
      .int({ error: ValidationErrorCode.INTEGER })
      .min(1, { error: ValidationErrorCode.TOO_SMALL })
      .max(5, { error: ValidationErrorCode.TOO_BIG })
      .optional(),
    sessionId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }).optional(),
    mode: PracticeModeSchema,
  }),
);

export const BatchPracticeItemSchema = registry.register(
  'BatchPracticeItem',
  z.object({
    flashcardId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }),
    wasCorrect: z.boolean({ error: ValidationErrorCode.REQUIRED }),
    confidenceLevel: z
      .number({ error: ValidationErrorCode.NUMBER })
      .int({ error: ValidationErrorCode.INTEGER })
      .min(1, { error: ValidationErrorCode.TOO_SMALL })
      .max(5, { error: ValidationErrorCode.TOO_BIG })
      .optional(),
    sessionId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }).optional(),
  }),
);

export const BatchPracticeSchema = registry.register(
  'BatchFlashcardPracticeRequest',
  z.object({
    items: z.array(BatchPracticeItemSchema).min(1, { error: ValidationErrorCode.TOO_FEW }),
    mode: PracticeModeSchema,
  }),
);

export const CompleteSessionSchema = registry.register(
  'CompleteSessionRequest',
  z.object({
    sessionId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }),
    startedAt: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .datetime({ error: ValidationErrorCode.INVALID_INPUT }),
    completedAt: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .datetime({ error: ValidationErrorCode.INVALID_INPUT }),
    durationMs: z
      .number({ error: ValidationErrorCode.NUMBER })
      .int({ error: ValidationErrorCode.INTEGER })
      .positive({ error: ValidationErrorCode.POSITIVE_NUMBER })
      // Two hours, the same cap the statistics apply: a longer session cannot be stored at all.
      .max(7_200_000, { error: ValidationErrorCode.TOO_BIG }),
    cardsStudied: z
      .number({ error: ValidationErrorCode.NUMBER })
      .int({ error: ValidationErrorCode.INTEGER })
      .min(0, { error: ValidationErrorCode.TOO_SMALL }),
    cardsCorrect: z
      .number({ error: ValidationErrorCode.NUMBER })
      .int({ error: ValidationErrorCode.INTEGER })
      .min(0, { error: ValidationErrorCode.TOO_SMALL }),
    deckIds: z.array(z.uuid({ error: ValidationErrorCode.UUID_INVALID })).optional(),
    mode: z.enum(['review', 'cram', 'quick'], { error: ValidationErrorCode.INVALID_INPUT }),
  }),
);

export type LogPracticeInput = z.infer<typeof LogPracticeSchema>;
export type PracticeMode = z.infer<typeof PracticeModeSchema>;
export type BatchPracticeItemInput = z.infer<typeof BatchPracticeItemSchema>;
export type BatchPracticeInput = z.infer<typeof BatchPracticeSchema>;
export type CompleteSessionInput = z.infer<typeof CompleteSessionSchema>;
export type PracticeCardData = z.infer<typeof PracticeCardSchema>;
export type PreparePracticeInput = z.infer<typeof PreparePracticeSchema>;

export interface DueBreakdownTopic {
  topic_id: string;
  count: number;
}

export interface DueBreakdownDeck {
  deck_id: string;
  count: number;
}

export interface DueBreakdownResponse {
  total: number;
  nextReviewAt: string | null;
  byTopic: DueBreakdownTopic[];
  byDeck: DueBreakdownDeck[];
}

export interface DueCountResponse {
  total: number;
}

export interface PracticeSummary {
  total: number;
  correct: number;
  lastPracticedAt: string | null;
}

export interface CardStatsItem {
  id: string;
  front: string;
  back: string;
  createdAt: string;
  state: 'new' | 'learning' | 'review' | 'relearning' | 'leech' | string;
  totalAttempts: number;
  correctRate: number;
  lastPracticedAt: string | null;
  easinessFactor: number | null;
  /** Interval magnitude; the unit is recorded in `intervalUnit`. */
  intervalValue: number | null;
  /** Minutes for learning/relearning steps, days for review intervals. */
  intervalUnit: IntervalUnit | null;
  nextReviewAt: string | null;
  repetitions: number | null;
  isLeech: boolean;
  learningStep: number | null;
  lapseCount: number | null;
}

export interface FlashcardRow {
  id: string;
  front: string;
  back: string;
  created_at: string;
  deck_id?: string | null;
  deck_name?: string | null;
  flashcard_topic_assignments?: Array<{
    topic_id: string;
    topics?: Array<{ name: string }>;
  }>;
}

export interface DueFlashcardItem {
  id: string;
  front: string;
  back: string;
  createdAt: string;
  reviewState: Record<string, unknown> | null;
  deckName: string | null;
  topicNames: string[];
}

export interface StateBreakdown {
  totalCards: number;
  neverPracticed: number;
  learning: number;
  review: number;
  relearning: number;
  leeched: number;
  /** Cards with ≥1 practice attempt — whole accessible collection, never state-filtered. */
  practicedCards: number;
  /** Mean of per-card correct rates, 0–100 (0 when nothing practiced). */
  averageAccuracy: number;
  /** Mean easiness factor over reviewed cards (0 when none). */
  averageEasinessFactor: number;
}

export interface CardStatsResponse {
  items: CardStatsItem[];
  nextCursor: string | null;
  hasMore: boolean;
}
