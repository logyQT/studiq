import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { registry, z } from '@studiq/server/lib/zod';

/** One answer the student gave during the attempt — shared by submit and draft save. */
export const QuizAnswerEntrySchema = z.object({
  questionId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }),
  selectedAnswerId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }).optional(),
  textAnswer: z.string().trim().max(10000, { error: ValidationErrorCode.TOO_LONG }).optional(),
});

export const SubmitQuizAttemptSchema = registry.register(
  'SubmitQuizAttemptRequest',
  z.object({
    attemptId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }),
    answers: z.array(QuizAnswerEntrySchema),
  }),
);

export const SaveQuizAnswersSchema = registry.register(
  'SaveQuizAnswersRequest',
  z.object({
    attemptId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }),
    answers: z.array(QuizAnswerEntrySchema).max(100, { error: ValidationErrorCode.TOO_MANY }),
  }),
);

export type SubmitQuizAttemptInput = z.infer<typeof SubmitQuizAttemptSchema>;
export type SaveQuizAnswersInput = z.infer<typeof SaveQuizAnswersSchema>;
