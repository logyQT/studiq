import { z, registry } from '@/lib/zod';

export const SubmitQuizAttemptSchema = registry.register(
  'SubmitQuizAttemptRequest',
  z.object({
    attemptId: z.uuid(),
    answers: z.array(
      z.object({
        questionId: z.uuid(),
        selectedAnswerId: z.uuid().optional(),
      }),
    ),
  }),
);

export type SubmitQuizAttemptInput = z.infer<typeof SubmitQuizAttemptSchema>;
