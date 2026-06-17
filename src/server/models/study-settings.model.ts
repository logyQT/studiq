import { z, registry } from '@/lib/zod';
import { ValidationErrorCode } from '@/lib/validation-errors';

export const UserStudySettingsSchema = registry.register(
  'UserStudySettings',
  z.object({
    userId: z.string().uuid({ error: ValidationErrorCode.UUID_INVALID }),
    learningSteps: z.array(z.number().int().positive({ error: ValidationErrorCode.POSITIVE_NUMBER })),
    newCardsPerDay: z.number().int().positive({ error: ValidationErrorCode.POSITIVE_NUMBER }),
    leechThreshold: z.number().int().positive({ error: ValidationErrorCode.POSITIVE_NUMBER }),
    newCardsIntroduced: z.number().int().nonnegative({ error: ValidationErrorCode.TOO_SMALL }),
    dailyResetDate: z.string({ error: ValidationErrorCode.REQUIRED }),
  }),
);

export type UserStudySettings = z.infer<typeof UserStudySettingsSchema>;
