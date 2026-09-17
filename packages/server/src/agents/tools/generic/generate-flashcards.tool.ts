import { conversationStorage } from '@studiq/server/lib/conversation-context';
import { enqueueTrace } from '@studiq/server/lib/trace-queue';
import { z } from '@studiq/server/lib/zod';
import { parseFlashcards } from '@studiq/server/services/ai-utils';
import { tool } from 'ai';

const flashcardSchema = z.object({
  front: z.string(),
  back: z.string(),
  topic: z.string().optional(),
});

export const generateFlashcardsTool = tool({
  description:
    'Generate flashcards on any topic. Pass the user request and desired count — the model generates the cards directly in the tool call. The model creates the flashcards; this tool just validates and returns them.',
  inputSchema: z.object({
    task: z.string().describe('The user request or topic for flashcards'),
    deck_name: z.string().optional().describe('Name for the flashcard deck'),
    count: z.number().min(1).max(200).optional().describe('Desired number of flashcards'),
    flashcards: z
      .array(flashcardSchema)
      .describe('The generated flashcards — one concept per card'),
  }),
  execute: async ({ task, deck_name, flashcards }) => {
    try {
      const cid = conversationStorage.getStore()?.conversationId;

      enqueueTrace({
        conversationId: cid,
        agentName: 'general',
        eventType: 'tool_call',
        label: 'generate_flashcards start',
        data: { task: task?.slice(0, 100), inputCount: flashcards?.length, deckName: deck_name },
      });

      const parsed = parseFlashcards(flashcards);

      enqueueTrace({
        conversationId: cid,
        agentName: 'general',
        eventType: 'tool_result',
        label: 'generate_flashcards end',
        data: { flashcardCount: parsed.length, deckName: deck_name || 'Generated Flashcards' },
      });

      return {
        type: 'flashcards' as const,
        deckName: deck_name || 'Generated Flashcards',
        flashcards: parsed,
        summary: `Generated ${parsed.length} flashcards`,
      };
    } catch (error) {
      return { type: 'error' as const, error: String(error) };
    }
  },
});
