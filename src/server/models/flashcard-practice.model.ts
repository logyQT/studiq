import { z, registry } from '@/lib/zod';
import { ValidationErrorCode } from '@/lib/validation-errors';

export const ReviewStateSchema = registry.register(
  'ReviewState',
  z.object({
    easinessFactor: z.number(),
    intervalDays: z.number(),
    repetitions: z.number(),
    nextReviewAt: z.string(),
    lastReviewedAt: z.string().nullable(),
    lastQuality: z.number().nullable(),
  }),
);

export const PracticeCardSchema = registry.register(
  'PracticeCard',
  z.object({
    id: z.string().uuid(),
    front: z.string(),
    back: z.string(),
    createdAt: z.string().nullable(),
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
  }),
);

export const CompleteSessionSchema = registry.register(
  'CompleteSessionRequest',
  z.object({
    sessionId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }),
    startedAt: z.string({ error: ValidationErrorCode.REQUIRED }).datetime({ error: ValidationErrorCode.INVALID_INPUT }),
    completedAt: z.string({ error: ValidationErrorCode.REQUIRED }).datetime({ error: ValidationErrorCode.INVALID_INPUT }),
    durationMs: z.number({ error: ValidationErrorCode.NUMBER }).int({ error: ValidationErrorCode.INTEGER }).positive({ error: ValidationErrorCode.POSITIVE_NUMBER }),
    cardsStudied: z.number({ error: ValidationErrorCode.NUMBER }).int({ error: ValidationErrorCode.INTEGER }).min(0, { error: ValidationErrorCode.TOO_SMALL }),
    cardsCorrect: z.number({ error: ValidationErrorCode.NUMBER }).int({ error: ValidationErrorCode.INTEGER }).min(0, { error: ValidationErrorCode.TOO_SMALL }),
    deckIds: z.array(z.uuid({ error: ValidationErrorCode.UUID_INVALID })).optional(),
    mode: z.enum(['study', 'practice', 'quick'], { error: ValidationErrorCode.INVALID_INPUT }),
  }),
);

export type LogPracticeInput = z.infer<typeof LogPracticeSchema>;
export type BatchPracticeItemInput = z.infer<typeof BatchPracticeItemSchema>;
export type BatchPracticeInput = z.infer<typeof BatchPracticeSchema>;
export type CompleteSessionInput = z.infer<typeof CompleteSessionSchema>;
export type PracticeCardData = z.infer<typeof PracticeCardSchema>;
export type PreparePracticeInput = z.infer<typeof PreparePracticeSchema>;
