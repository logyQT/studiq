import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { registry, z } from '@studiq/server/lib/zod';

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
