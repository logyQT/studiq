import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { registry, z } from '@studiq/server/lib/zod';

/** One answer the student gave during the attempt — shared by submit and draft save. */
export const QuizAnswerEntrySchema = z.object({
  questionId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }),
  selectedAnswerId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }).optional(),
  textAnswer: z.string().trim().max(10000, { error: ValidationErrorCode.TOO_LONG }).optional(),
});

export type QuizAnswerEntry = z.infer<typeof QuizAnswerEntrySchema>;

/**
 * Parser bound only, not the product limit: an answer sheet cannot be longer
 * than the attempt's own question list, and `QuizAttemptService` enforces that
 * once it has loaded the attempt (#1065). Nothing caps an assignment's size
 * (`AddQuestionsSchema` takes any number of questions), so a fixed low bound
 * would reject a legitimate submit; 500 is above any plausible assignment
 * while still keeping one request from carrying a pathological array.
 */
const MAX_ANSWER_ENTRIES = 500;

const QuizAnswersArraySchema = z
  .array(QuizAnswerEntrySchema)
  .max(MAX_ANSWER_ENTRIES, { error: ValidationErrorCode.TOO_MANY });

/**
 * One `student_answers` row per question is the write contract (#1065): the
 * answer value carries the student's selection, so a repeated question id in a
 * single submit would store two rows for one answer — the shape #1066's
 * `UNIQUE (attempt_id, question_id)` forbids. Refuse it here instead of letting
 * the database reject the whole insert. The draft save instead keys its map by
 * question id, where the last entry wins.
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
