import { z, registry } from '@/lib/zod';
import { ValidationErrorCode } from '@/lib/validation-errors';

export const DueCardsQuerySchema = registry.register(
  'DueCardsQuery',
  z.object({
    topicIds: z
      .string({ error: ValidationErrorCode.INVALID_INPUT })
      .optional(),
    deckIds: z
      .string({ error: ValidationErrorCode.INVALID_INPUT })
      .optional(),
    limit: z
      .string({ error: ValidationErrorCode.INVALID_INPUT })
      .optional()
      .default('20'),
  }),
);

export type DueCardsQueryInput = z.infer<typeof DueCardsQuerySchema>;

export type LearningState = 'new' | 'learning' | 'review' | 'relearning';
export type Rating = 1 | 2 | 3 | 4;
export type IntervalUnit = 'minutes' | 'days';

export interface CalculateNextReviewInput {
  learningState: LearningState;
  currentStep: number;
  learningSteps: number[];
  rating: Rating;
  easinessFactor: number;
  interval: number;
  repetitions: number;
  lapseCount: number;
  leechThreshold: number;
}

export interface CalculateNextReviewOutput {
  learningState: Exclude<LearningState, 'new'>;
  learningStep: number;
  newEasinessFactor: number;
  newInterval: number;
  newRepetitions: number;
  nextReviewAt: Date;
  intervalUnit: IntervalUnit;
  lapseCount: number;
  isLeech: boolean;
}
