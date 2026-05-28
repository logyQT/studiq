import { ValidationErrorCode } from '@/lib/validation-errors';
import { z, registry } from '@/lib/zod';

export const SubmitQuizAttemptSchema = registry.register(
  'SubmitQuizAttemptRequest',
  z.object({
    attemptId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }),
    answers: z.array(
      z.object({
        questionId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }),
        selectedAnswerId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }).optional(),
      }),
    ),
  }),
);

export type SubmitQuizAttemptInput = z.infer<typeof SubmitQuizAttemptSchema>;
