import { z, registry } from '@/lib/zod';
import { AppErrorCode } from '@/lib/errors';

const uuid = z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);

export const GenerateQuizSchema = registry.register(
  'GenerateQuizRequest',
  z.object({
    subjectId: uuid.optional(),
    questionTypes: z.array(z.enum(['mcq', 'true_false', 'open'])).min(1, { error: AppErrorCode.INVALID_INPUT }),
    difficulty: z.enum(['easy', 'medium', 'hard', 'mixed']).optional(),
    questionCount: z.number().int().min(1).max(50),
  }),
);

export const SubmitQuizAttemptSchema = registry.register(
  'SubmitQuizAttemptRequest',
  z.object({
    attemptId: uuid,
    answers: z.array(
      z.object({
        questionId: uuid,
        selectedAnswerId: uuid.optional(),
      }),
    ),
  }),
);

export type GenerateQuizInput = z.infer<typeof GenerateQuizSchema>;
export type SubmitQuizAttemptInput = z.infer<typeof SubmitQuizAttemptSchema>;
