import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { registry, z } from '@studiq/server/lib/zod';

/**
 * The field contract shared by create and update, deliberately default-free: Zod keeps a `.default()`
 * through `.partial()`, so an update built from a defaulted schema would fill the create defaults in
 * for every omitted field and rewrite the run's rules on any edit (#1222). Defaults live on the
 * create schema alone, where an omitted field is a decision the caller made.
 */
const teacherAssignmentFields = z.object({
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
  shuffleQuestions: z.boolean({ error: ValidationErrorCode.BOOL }),
  shuffleAnswers: z.boolean({ error: ValidationErrorCode.BOOL }),
  showResults: z.boolean({ error: ValidationErrorCode.BOOL }),
  maxAttempts: z
    .number({ error: ValidationErrorCode.NUMBER })
    .int({ error: ValidationErrorCode.INTEGER })
    .min(1, { error: ValidationErrorCode.TOO_SMALL })
    .max(10, { error: ValidationErrorCode.TOO_BIG }),
  passingScore: z
    .number({ error: ValidationErrorCode.NUMBER })
    .int({ error: ValidationErrorCode.INTEGER })
    .min(0, { error: ValidationErrorCode.TOO_SMALL })
    .max(100, { error: ValidationErrorCode.TOO_BIG })
    .optional(),
});

export const CreateTeacherAssignmentSchema = registry.register(
  'CreateTeacherAssignmentRequest',
  teacherAssignmentFields.extend({
    shuffleQuestions: teacherAssignmentFields.shape.shuffleQuestions.default(true),
    shuffleAnswers: teacherAssignmentFields.shape.shuffleAnswers.default(true),
    showResults: teacherAssignmentFields.shape.showResults.default(false),
    maxAttempts: teacherAssignmentFields.shape.maxAttempts.default(1),
  }),
);
export type CreateTeacherAssignmentInput = z.infer<typeof CreateTeacherAssignmentSchema>;

export const UpdateTeacherAssignmentSchema = registry.register(
  'UpdateTeacherAssignmentRequest',
  teacherAssignmentFields.partial(),
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
    /** Cross-class exposure is blocking; the teacher decides it explicitly (R3). */
    acknowledgeExposure: z.boolean({ error: ValidationErrorCode.BOOL }).default(false),
    /** Seal every item for the whole organisation, not only the targeted classes (R3). */
    sealOrgWide: z.boolean({ error: ValidationErrorCode.BOOL }).default(false),
  }),
);
export type PublishAssignmentInput = z.infer<typeof PublishAssignmentSchema>;

export const WithholdItemSchema = registry.register(
  'WithholdItemRequest',
  z.object({
    /** `true` holds the item back from the cohort review; `false` takes the hold off again. */
    withheld: z.boolean({ error: ValidationErrorCode.BOOL }),
  }),
);
export type WithholdItemInput = z.infer<typeof WithholdItemSchema>;

/**
 * The publish preconditions, validated against the **stored** assessment plus the request's window.
 * Not registered: this is not a request contract, it is a server-side configuration check. Issues
 * carry the field `path`, so the client can point at the composer control that fixes it.
 */
export const PublishableAssignmentSchema = z
  .object({
    targets: z.array(z.unknown()).min(1, { error: ValidationErrorCode.REQUIRED }),
    items: z.array(z.unknown()).min(1, { error: ValidationErrorCode.REQUIRED }),
    // A published run must be able to end: without a close there is no reveal and the seal never
    // lifts (R2/R5).
    // A stored `timestamptz` serialises with an offset, while the composer sends `toISOString()`;
    // both are a valid window bound.
    deadline: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .datetime({ offset: true, error: ValidationErrorCode.REQUIRED }),
    startTime: z.string().datetime({ offset: true }).nullish(),
    maxAttempts: z
      .number({ error: ValidationErrorCode.NUMBER })
      .int({ error: ValidationErrorCode.INTEGER })
      .min(1, { error: ValidationErrorCode.TOO_SMALL }),
  })
  .superRefine((config, ctx) => {
    if (!config.startTime) return;
    if (new Date(config.startTime).getTime() >= new Date(config.deadline).getTime()) {
      ctx.addIssue({
        code: 'custom',
        path: ['startTime'],
        error: ValidationErrorCode.INVALID_INPUT,
      });
    }
  });
