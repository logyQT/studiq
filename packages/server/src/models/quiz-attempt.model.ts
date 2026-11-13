import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { registry, z } from '@studiq/server/lib/zod';

/**
 * One answer the student gave during the attempt — shared by submit and draft
 * save. The value is exactly one kind (#1161): an option choice, free text, or
 * an explicit skip.
 */
const QuizAnswerValueSchema = z.object({
  questionId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }),
  selectedAnswerId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }).optional(),
  textAnswer: z.string().trim().max(10000, { error: ValidationErrorCode.TOO_LONG }).optional(),
  /** Explicitly unanswered: no `student_answers` row, no draft key, no score (#1161). */
  skipped: z.literal(true, { error: ValidationErrorCode.INVALID_INPUT }).optional(),
});

/**
 * Scoring trusts the answer value it is handed, so an entry carrying two kinds
 * of value (or none) has no single answer to score. Refusing it here keeps both
 * write paths on one shape instead of guessing which field wins (#1161).
 */
function requireOneAnswerKind(answer: z.infer<typeof QuizAnswerValueSchema>, ctx: z.RefinementCtx) {
  const kinds = [
    answer.selectedAnswerId !== undefined,
    answer.textAnswer !== undefined,
    answer.skipped === true,
  ].filter(Boolean).length;

  if (kinds === 0) {
    ctx.addIssue({ code: 'custom', message: ValidationErrorCode.REQUIRED });
    return;
  }

  if (kinds > 1) {
    // When an option came with free text, name the field the contract pairs
    // with the question's type; any other mix is ambiguous as a whole.
    const path =
      answer.selectedAnswerId !== undefined && answer.textAnswer !== undefined
        ? ['textAnswer']
        : [];
    ctx.addIssue({ code: 'custom', path, message: ValidationErrorCode.INVALID_INPUT });
    return;
  }

  // `textAnswer` is trimmed, so this also covers whitespace-only input. A
  // cleared answer is `skipped`; an empty string is not an answer.
  if (answer.textAnswer?.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['textAnswer'],
      message: ValidationErrorCode.REQUIRED,
    });
  }
}

export const QuizAnswerEntrySchema = QuizAnswerValueSchema.superRefine(requireOneAnswerKind);

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
