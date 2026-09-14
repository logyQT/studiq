import { ValidationErrorCode } from '@/lib/validation-errors';
import { registry, z } from '@/lib/zod';

export const CreateTeacherAssignmentSchema = registry.register(
  'CreateTeacherAssignmentRequest',
  z.object({
    title: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .max(200, { error: ValidationErrorCode.TOO_LONG }),
    description: z.string().max(2000, { error: ValidationErrorCode.TOO_LONG }).optional(),
    quizId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }).optional(),
    deadline: z.string().datetime().optional(),
    timeLimitMin: z
      .number({ error: ValidationErrorCode.NUMBER })
      .int({ error: ValidationErrorCode.INTEGER })
      .min(1, { error: ValidationErrorCode.TOO_SMALL })
      .max(300, { error: ValidationErrorCode.TOO_BIG })
      .optional(),
    shuffleQuestions: z.boolean({ error: ValidationErrorCode.BOOL }).default(true),
    shuffleAnswers: z.boolean({ error: ValidationErrorCode.BOOL }).default(true),
    showResults: z.boolean({ error: ValidationErrorCode.BOOL }).default(false),
    maxAttempts: z
      .number({ error: ValidationErrorCode.NUMBER })
      .int({ error: ValidationErrorCode.INTEGER })
      .min(1, { error: ValidationErrorCode.TOO_SMALL })
      .max(10, { error: ValidationErrorCode.TOO_BIG })
      .default(1),
    passingScore: z
      .number({ error: ValidationErrorCode.NUMBER })
      .int({ error: ValidationErrorCode.INTEGER })
      .min(0, { error: ValidationErrorCode.TOO_SMALL })
      .max(100, { error: ValidationErrorCode.TOO_BIG })
      .optional(),
  }),
);
export type CreateTeacherAssignmentInput = z.infer<typeof CreateTeacherAssignmentSchema>;

export const UpdateTeacherAssignmentSchema = registry.register(
  'UpdateTeacherAssignmentRequest',
  CreateTeacherAssignmentSchema.partial(),
);
export type UpdateTeacherAssignmentInput = z.infer<typeof UpdateTeacherAssignmentSchema>;

export const AddQuestionsSchema = registry.register(
  'AddQuestionsRequest',
  z.object({
    questionIds: z
      .array(z.uuid({ error: ValidationErrorCode.UUID_INVALID }))
      .min(1, { error: ValidationErrorCode.TOO_FEW }),
  }),
);
export type AddQuestionsInput = z.infer<typeof AddQuestionsSchema>;

export const RemoveQuestionSchema = registry.register(
  'RemoveQuestionRequest',
  z.object({
    questionId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }),
  }),
);
export type RemoveQuestionInput = z.infer<typeof RemoveQuestionSchema>;

export const RandomizeSchema = registry.register(
  'RandomizeRequest',
  z.object({
    source: z.enum(['bank', 'topic', 'all']),
    sourceId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }).optional(),
    count: z
      .number({ error: ValidationErrorCode.NUMBER })
      .int({ error: ValidationErrorCode.INTEGER })
      .min(1, { error: ValidationErrorCode.TOO_SMALL })
      .max(50, { error: ValidationErrorCode.TOO_BIG }),
    types: z
      .array(z.enum(['mcq', 'true_false', 'open']))
      .min(1)
      .optional(),
  }),
);
export type RandomizeInput = z.infer<typeof RandomizeSchema>;

export const SetTargetsSchema = registry.register(
  'SetTargetsRequest',
  z.object({
    groupIds: z.array(z.uuid({ error: ValidationErrorCode.UUID_INVALID })).optional(),
    studentIds: z.array(z.uuid({ error: ValidationErrorCode.UUID_INVALID })).optional(),
  }),
);
export type SetTargetsInput = z.infer<typeof SetTargetsSchema>;

export const ReorderQuestionsSchema = registry.register(
  'ReorderQuestionsRequest',
  z.object({
    questionIds: z
      .array(z.uuid({ error: ValidationErrorCode.UUID_INVALID }))
      .min(1, { error: ValidationErrorCode.TOO_FEW }),
  }),
);
export type ReorderQuestionsInput = z.infer<typeof ReorderQuestionsSchema>;

export const GradeAnswerSchema = registry.register(
  'GradeAnswerRequest',
  z.object({
    questionId: z.uuid({ error: ValidationErrorCode.UUID_INVALID }),
    points: z
      .number({ error: ValidationErrorCode.NUMBER })
      .int({ error: ValidationErrorCode.INTEGER })
      .min(0, { error: ValidationErrorCode.TOO_SMALL }),
    feedback: z.string().max(1000, { error: ValidationErrorCode.TOO_LONG }).optional(),
  }),
);
export type GradeAnswerInput = z.infer<typeof GradeAnswerSchema>;

export const PublishAssignmentSchema = registry.register(
  'PublishAssignmentRequest',
  z.object({
    deadline: z.string().datetime().optional(),
    startTime: z.string().datetime().optional(),
  }),
);
export type PublishAssignmentInput = z.infer<typeof PublishAssignmentSchema>;
