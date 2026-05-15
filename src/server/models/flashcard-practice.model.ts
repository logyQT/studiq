import { z, registry } from '@/lib/zod';

const uuid = z
  .string()
  .regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);

export const LogPracticeSchema = registry.register(
  'LogFlashcardPracticeRequest',
  z.object({
    wasCorrect: z.boolean(),
    responseTimeMs: z.number().int().positive().optional(),
    confidenceLevel: z.number().int().min(1).max(5).optional(),
    sessionId: uuid.optional(),
  }),
);

export type LogPracticeInput = z.infer<typeof LogPracticeSchema>;
