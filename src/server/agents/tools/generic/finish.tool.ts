import { z } from '@/lib/zod';
import type { FlashcardItem } from '@/server/services/ai-utils';
import type { Tool } from '../types';

const params = z.object({
  message: z.string().optional(),
});

export const finishTool: Tool = {
  name: 'finish',
  description:
    'Complete the current task and return the results. Call this when you have successfully generated the requested educational content.',
  parameters: params,
  async execute(args, ctx) {
    const parsed = params.parse(args);
    const flashcards = ctx.state.results.flashcards as FlashcardItem[] | undefined;
    const deckName = ctx.state.results.deckName as string | undefined;

    if (flashcards && flashcards.length > 0) {
      return {
        type: 'flashcards',
        deckName: deckName || 'Generated Flashcards',
        flashcards,
      };
    }

    return {
      type: 'chat',
      content: parsed.message || '',
    };
  },
};
