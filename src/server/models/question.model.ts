import { z, registry } from '@/lib/zod';
import { ValidationErrorCode } from '@/lib/validation-errors';

export const QuestionTypeEnum = z.enum(['mcq', 'true_false', 'open']);
export const DifficultyEnum = z.enum(['easy', 'medium', 'hard']);

export const CreateQuestionSchema = registry.register(
  'CreateQuestionRequest',
  z.object({
    subjectId: z.string().uuid().optional(),
    type: QuestionTypeEnum,
    content: z.string().min(1, { error: ValidationErrorCode.INVALID_INPUT }),
    explanation: z.string().optional(),
    difficulty: DifficultyEnum.default('medium'),
    answers: z
      .array(
        z.object({
          content: z.string().min(1, { error: ValidationErrorCode.INVALID_INPUT }),
          isCorrect: z.boolean(),
          orderIndex: z.number().int().default(0),
        }),
      )
      .min(1, { error: ValidationErrorCode.INVALID_INPUT }),
  }),
);

export const UpdateQuestionSchema = registry.register(
  'UpdateQuestionRequest',
  z.object({
    subjectId: z.string().uuid().optional(),
    type: QuestionTypeEnum.optional(),
    content: z.string().min(1, { error: ValidationErrorCode.INVALID_INPUT }).optional(),
    explanation: z.string().optional(),
    difficulty: DifficultyEnum.optional(),
    answers: z
      .array(
        z.object({
          id: z.string().uuid().optional(),
          content: z.string().min(1, { error: ValidationErrorCode.INVALID_INPUT }),
          isCorrect: z.boolean(),
          orderIndex: z.number().int().default(0),
        }),
      )
      .optional(),
  }),
);

export type CreateQuestionInput = z.infer<typeof CreateQuestionSchema>;
export type UpdateQuestionInput = z.infer<typeof UpdateQuestionSchema>;
