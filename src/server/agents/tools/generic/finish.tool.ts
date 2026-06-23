import { tool } from 'ai';
import { z } from '@/lib/zod';

const flashcardSchema = z.object({
  front: z.string(),
  back: z.string(),
  topic: z.string().optional(),
});

export const finishTool = tool({
  description:
    'Complete the current task and return the results to the user. Call this after generate_flashcards finishes.',
  inputSchema: z.object({
    type: z
      .enum(['chat', 'flashcards'])
      .describe('Type of result to return'),
    message: z
      .string()
      .optional()
      .describe('Summary message for chat results'),
    deckName: z
      .string()
      .optional()
      .describe('Name of the flashcard deck'),
    flashcards: z
      .array(flashcardSchema)
      .optional()
      .describe('Generated flashcards'),
  }),
  execute: async ({ type, message, deckName, flashcards }) => {
    if (type === 'flashcards' && flashcards?.length) {
      return {
        type: 'flashcards' as const,
        deckName: deckName || 'Generated Flashcards',
        flashcards,
      };
    }
    return { type: 'chat' as const, content: message || '' };
  },
});
