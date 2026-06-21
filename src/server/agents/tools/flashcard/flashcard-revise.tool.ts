import { z } from '@/lib/zod';
import { GENERATE_FROM_TERMS_SYSTEM_PROMPT, GENERATE_FLASHCARDS_TOOL } from '@/server/services/ai-prompts';
import { parseFlashcards } from '@/server/services/ai-utils';
import type { Tool } from '../types';

const params = z.object({
  cards: z.array(z.object({
    front: z.string(),
    back: z.string(),
    topic: z.string().optional(),
  })),
  feedback: z.string(),
});

export const flashcardReviseTool: Tool = {
  name: 'flashcard_revise',
  description: 'Revise and improve flashcards based on quality feedback. Rewrites cards to better meet quality criteria.',
  parameters: params,
  async execute(args, ctx) {
    const parsed = params.parse(args);

    const prompt = `Revise these flashcards based on the feedback below.\n\nFeedback: ${parsed.feedback}\n\nCards:\n${JSON.stringify(parsed.cards, null, 2)}`;

    const result = await ctx.callLLM({
      prompt,
      systemPrompt: GENERATE_FROM_TERMS_SYSTEM_PROMPT + '\nFocus on fixing the issues mentioned in the feedback.',
      tools: [GENERATE_FLASHCARDS_TOOL],
      toolChoice: { type: 'function', function: { name: 'generate_flashcards' } },
      maxTokens: 4096,
    });

    const toolCall = result.toolCalls?.find((tc) => tc.function.name === 'generate_flashcards');
    if (!toolCall) {
      return { revised: parsed.cards };
    }

    let llmResult: { deck_name?: string; flashcards: unknown[] };
    try {
      llmResult = JSON.parse(toolCall.function.arguments);
    } catch {
      return { revised: parsed.cards };
    }

    const revised = parseFlashcards(llmResult.flashcards);
    ctx.state.results['flashcards'] = revised;

    ctx.callbacks?.onThinking?.(`Revised to ${revised.length} improved flashcards`);

    return { revised };
  },
};
