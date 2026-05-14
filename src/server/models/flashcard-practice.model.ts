import { z, registry } from '@/lib/zod';

const uuid = z
  .string()
  .regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);

export const LogPracticeSchema = registry.register(
  'LogFlashcardPracticeRequest',
  z.object({
    flashcardId: uuid,
    wasCorrect: z.boolean(),
  }),
);

export type LogPracticeInput = z.infer<typeof LogPracticeSchema>;
