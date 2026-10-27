import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { registry, z } from '@studiq/server/lib/zod';
import { QuestionTypeEnum } from '@studiq/server/models/question.model';

/** Most questions one import may create; bigger banks are split into several files. */
export const IMPORT_MAX_QUESTIONS = 500;
/**
 * An export never truncates silently: a bank above this size is refused with an explicit error
 * ("bank too large - split it").
 */
export const EXPORT_MAX_QUESTIONS = 1000;
/** Answers per question, in both formats (the CSV has this many `answer_N` columns). */
export const TRANSFER_MAX_ANSWERS = 10;
export const TRANSFER_MAX_TOPICS = 10;

export const TransferAnswerSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, { error: ValidationErrorCode.INVALID_INPUT })
    .max(255, { error: ValidationErrorCode.TOO_LONG }),
  isCorrect: z.boolean({ error: ValidationErrorCode.BOOL }),
});

/**
 * One question as exported and imported. The same shape is the JSON file format and the
 * result of reading a CSV row, so both formats share the validation below.
 */
export const TransferQuestionSchema = z
  .object({
    type: QuestionTypeEnum,
    content: z
      .string()
      .trim()
      .min(1, { error: ValidationErrorCode.INVALID_INPUT })
      .max(255, { error: ValidationErrorCode.TOO_LONG }),
    explanation: z.string().trim().max(255, { error: ValidationErrorCode.TOO_LONG }).optional(),
    topics: z
      .array(z.string().trim().min(1).max(100, { error: ValidationErrorCode.TOO_LONG }))
      .max(TRANSFER_MAX_TOPICS, { error: ValidationErrorCode.TOO_MANY })
      .default([]),
    answers: z
      .array(TransferAnswerSchema)
      .max(TRANSFER_MAX_ANSWERS, { error: ValidationErrorCode.TOO_MANY })
      .default([]),
  })
  .superRefine((question, ctx) => {
    const correct = question.answers.filter((answer) => answer.isCorrect).length;
    const fail = () =>
      ctx.addIssue({
        code: 'custom',
        message: ValidationErrorCode.INVALID_INPUT,
        path: ['answers'],
      });

    // Same rules the question form enforces: a choice question has options with a right one,
    // true / false has exactly the two options with exactly one right, open has no options.
    if (question.type === 'mcq' && (question.answers.length < 2 || correct < 1)) fail();
    if (question.type === 'true_false' && (question.answers.length !== 2 || correct !== 1)) fail();
    if (question.type === 'open' && question.answers.length > 0) fail();
  });

export const ImportQuestionsSchema = registry.register(
  'ImportQuestionsRequest',
  z.object({
    questions: z
      .array(TransferQuestionSchema)
      .min(1, { error: ValidationErrorCode.TOO_FEW })
      .max(IMPORT_MAX_QUESTIONS, { error: ValidationErrorCode.TOO_MANY }),
  }),
);

export const ExportQuestionsQuerySchema = registry.register(
  'ExportQuestionsQuery',
  z.object({
    format: z.enum(['csv', 'json']).default('csv'),
  }),
);

export type TransferQuestion = z.infer<typeof TransferQuestionSchema>;
export type ImportQuestionsInput = z.infer<typeof ImportQuestionsSchema>;

export interface ImportQuestionsResult {
  imported: number;
}
