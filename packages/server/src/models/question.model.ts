import {
  EXPLANATION_MAX_LENGTH,
  MODEL_ANSWER_MAX_LENGTH,
  questionTextIssues,
} from '@studiq/server/lib/question-explanation';
import { groupsParamSchema } from '@studiq/server/lib/query-list';
import { QUESTION_SEARCH_MAX_LENGTH } from '@studiq/server/lib/question-search';
import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { registry, z } from '@studiq/server/lib/zod';

export const QuestionTypeEnum = z.enum(['mcq', 'true_false', 'open']);

/** The authoring artefact of a choice item: required, bounded, and checked by R17. */
const ExplanationField = z.string().max(EXPLANATION_MAX_LENGTH, {
  error: ValidationErrorCode.TOO_LONG,
});
/** The authoring artefact of an open item, which has no key to explain. */
const ModelAnswerField = z.string().max(MODEL_ANSWER_MAX_LENGTH, {
  error: ValidationErrorCode.TOO_LONG,
});

/**
 * Query of `GET /api/v1/questions`. Without `page` the endpoint keeps answering with the
 * whole list (quiz builder, assignments); with `page` it answers `{ items, total, page, limit }`
 * and search, type filter and sort run in the database (#651).
 */
export const QuestionListQuerySchema = registry.register(
  'QuestionListQuery',
  z.object({
    bankId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }).optional(),
    // `topicIds=a,b`: comma-joined uuids, trimmed, deduped, max 50. Anything else is a 422, not a
    // 22P02 from the database.
    topicIds: groupsParamSchema,
    type: QuestionTypeEnum.optional(),
    search: z
      .string()
      .trim()
      .max(QUESTION_SEARCH_MAX_LENGTH, { error: ValidationErrorCode.TOO_LONG })
      .optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    sortBy: z.enum(['created_at', 'content', 'type']).optional(),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  }),
);

export const CreateQuestionSchema = registry.register(
  'CreateQuestionRequest',
  z
    .object({
      bankId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }),
      topicIds: z.array(z.uuid({ error: ValidationErrorCode.UUID_INVALID })).optional(),
      type: QuestionTypeEnum,
      content: z
        .string()
        .nonempty({ error: ValidationErrorCode.INVALID_INPUT })
        .min(1, { error: ValidationErrorCode.TOO_SHORT })
        .max(255, { error: ValidationErrorCode.TOO_LONG }),
      explanation: ExplanationField.optional(),
      modelAnswer: ModelAnswerField.optional(),
      answers: z
        .array(
          z.object({
            content: z
              .string()
              .nonempty({ error: ValidationErrorCode.INVALID_INPUT })
              .min(1, { error: ValidationErrorCode.TOO_SHORT })
              .max(255, { error: ValidationErrorCode.TOO_LONG }),
            isCorrect: z.boolean({ error: ValidationErrorCode.BOOL }),
            orderIndex: z
              .number({ error: ValidationErrorCode.NUMBER })
              .int({ error: ValidationErrorCode.INTEGER })
              .default(0),
          }),
        )
        .default([]),
    })
    .superRefine((data, ctx) => {
      // R16/R17: the item's artefact is part of its validity, not a form nicety.
      for (const issue of questionTextIssues({
        type: data.type,
        explanation: data.explanation,
        modelAnswer: data.modelAnswer,
        options: data.answers.map((answer) => answer.content),
      })) {
        ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path });
      }
      if (data.type !== 'open' && data.answers.length === 0) {
        ctx.addIssue({
          code: 'custom',
          message: ValidationErrorCode.INVALID_INPUT,
          path: ['answers'],
        });
      }
    }),
);

export const UpdateQuestionSchema = registry.register(
  'UpdateQuestionRequest',
  z
    .object({
      bankId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }).optional(),
      topicIds: z.array(z.uuid({ error: ValidationErrorCode.UUID_INVALID })).optional(),
      type: QuestionTypeEnum.optional(),
      content: z
        .string()
        .nonempty({ error: ValidationErrorCode.INVALID_INPUT })
        .min(1, { error: ValidationErrorCode.TOO_SHORT })
        .max(255, { error: ValidationErrorCode.TOO_LONG })
        .optional(),
      explanation: ExplanationField.optional(),
      modelAnswer: ModelAnswerField.optional(),
      answers: z
        .array(
          z.object({
            id: z.uuid({ error: ValidationErrorCode.UUID_INVALID }).optional(),
            content: z.string().min(1, { error: ValidationErrorCode.INVALID_INPUT }),
            isCorrect: z.boolean({ error: ValidationErrorCode.BOOL }),
            orderIndex: z
              .number({ error: ValidationErrorCode.NUMBER })
              .int({ error: ValidationErrorCode.INTEGER })
              .default(0),
          }),
        )
        .optional(),
      visibility: z.enum(['personal', 'group']).optional(),
    })
    .refine(
      (data) => !(data.type !== undefined && data.type !== 'open' && data.answers?.length === 0),
      {
        error: ValidationErrorCode.INVALID_INPUT,
        path: ['answers'],
      },
    ),
);

export type QuestionListQuery = z.infer<typeof QuestionListQuerySchema>;
export type CreateQuestionInput = z.infer<typeof CreateQuestionSchema>;
export type UpdateQuestionInput = z.infer<typeof UpdateQuestionSchema>;

export interface QuestionAnswer {
  id: string;
  question_id: string;
  content: string;
  is_correct: boolean;
  order_index: number;
}

export interface Question {
  id: string;
  organization_id: string | null;
  created_by: string;
  type: 'mcq' | 'true_false' | 'open';
  content: string;
  explanation: string | null;
  /** The open item's model answer; only a caller who may read the key receives it. */
  model_answer?: string | null;
  visibility?: 'personal' | 'group';
  created_at: string;
  updated_at: string;
  question_answers: QuestionAnswer[];
  topics?: Array<{ id: string; name: string }>;
}

/** Answer of `GET /api/v1/questions` when `page` is given. */
export interface PaginatedQuestions {
  items: Question[];
  total: number;
  page: number;
  limit: number;
}
