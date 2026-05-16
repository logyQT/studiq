import { z, registry } from '@/lib/zod';

export const LogPracticeSchema = registry.register(
  'LogFlashcardPracticeRequest',
  z.object({
    wasCorrect: z.boolean(),
    responseTimeMs: z.number().int().positive().optional(),
    confidenceLevel: z.number().int().min(1).max(5).optional(),
    sessionId: z.uuid().optional(),
  }),
);

export type LogPracticeInput = z.infer<typeof LogPracticeSchema>;
