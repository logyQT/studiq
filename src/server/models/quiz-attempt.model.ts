import { z, registry } from '@/lib/zod';

const uuid = z
  .string()
  .regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);

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

export type SubmitQuizAttemptInput = z.infer<typeof SubmitQuizAttemptSchema>;
