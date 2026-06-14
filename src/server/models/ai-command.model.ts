import { z } from 'zod';

export const FlashcardGenRequestSchema = z.object({
  text: z.string().min(1, 'Text is required'),
});

export type FlashcardGenRequest = z.infer<typeof FlashcardGenRequestSchema>;
