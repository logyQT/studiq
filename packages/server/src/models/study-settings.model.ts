import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { registry, z } from '@studiq/server/lib/zod';

export const UserStudySettingsSchema = registry.register(
  'UserStudySettings',
  z.object({
    userId: z.string().uuid({ error: ValidationErrorCode.UUID_INVALID }),
    learningSteps: z.array(
      z.number().int().positive({ error: ValidationErrorCode.POSITIVE_NUMBER }),
    ),
    newCardsPerDay: z.number().int().positive({ error: ValidationErrorCode.POSITIVE_NUMBER }),
    leechThreshold: z.number().int().positive({ error: ValidationErrorCode.POSITIVE_NUMBER }),
    newCardsIntroduced: z.number().int().nonnegative({ error: ValidationErrorCode.TOO_SMALL }),
    dailyResetDate: z.string({ error: ValidationErrorCode.REQUIRED }),
    dailyReviewGoal: z
      .number()
      .int()
      .nonnegative({ error: ValidationErrorCode.TOO_SMALL })
      .optional()
      .default(0),
  }),
);

/** Most reviews a day the goal may ask for; 0 turns the goal off. */
export const MAX_DAILY_REVIEW_GOAL = 1000;

/** Body of `PUT /api/v1/flashcards/practice/settings`: what a student may change themselves. */
export const UpdateStudySettingsSchema = registry.register(
  'UpdateStudySettings',
  z.object({
    dailyReviewGoal: z
      .number({ error: ValidationErrorCode.NUMBER })
      .int({ error: ValidationErrorCode.INTEGER })
      .min(0, { error: ValidationErrorCode.TOO_SMALL })
      .max(MAX_DAILY_REVIEW_GOAL, { error: ValidationErrorCode.TOO_BIG }),
  }),
);

export type UserStudySettings = z.infer<typeof UserStudySettingsSchema>;
export type UpdateStudySettingsInput = z.infer<typeof UpdateStudySettingsSchema>;
