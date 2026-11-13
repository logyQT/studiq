import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { registry, z } from '@studiq/server/lib/zod';

/** One answer the student gave during the attempt — shared by submit and draft save. */
export const QuizAnswerEntrySchema = z.object({
  questionId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }),
  selectedAnswerId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }).optional(),
  textAnswer: z.string().trim().max(10000, { error: ValidationErrorCode.TOO_LONG }).optional(),
});

export type QuizAnswerEntry = z.infer<typeof QuizAnswerEntrySchema>;

/** Submit mirrors the draft's cap so one request cannot carry an unbounded answer sheet (#1065). */
const QuizAnswersArraySchema = z
  .array(QuizAnswerEntrySchema)
  .max(100, { error: ValidationErrorCode.TOO_MANY });

/**
 * Submit is a single write of the whole answer sheet, so the same question twice
 * would store a duplicate `student_answers` row (#1065). The draft save instead
 * keys its map by question id, where the last entry wins.
 */
function rejectRepeatedQuestions(answers: QuizAnswerEntry[], ctx: z.RefinementCtx) {
  const seen = new Set<string>();
  answers.forEach((answer, index) => {
    if (seen.has(answer.questionId)) {
      ctx.addIssue({
        code: 'custom',
        path: [index, 'questionId'],
        message: ValidationErrorCode.INVALID_INPUT,
      });
    }
    seen.add(answer.questionId);
  });
}

export const SubmitQuizAttemptSchema = registry.register(
  'SubmitQuizAttemptRequest',
  z.object({
    attemptId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }),
    answers: QuizAnswersArraySchema.superRefine(rejectRepeatedQuestions),
  }),
);

export const SaveQuizAnswersSchema = registry.register(
  'SaveQuizAnswersRequest',
  z.object({
    attemptId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }),
    answers: QuizAnswersArraySchema,
  }),
);

export type SubmitQuizAttemptInput = z.infer<typeof SubmitQuizAttemptSchema>;
export type SaveQuizAnswersInput = z.infer<typeof SaveQuizAnswersSchema>;
