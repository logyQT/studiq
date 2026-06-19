import { z } from '@/lib/zod';
import { GENERATE_FROM_TERMS_SYSTEM_PROMPT, GENERATE_FLASHCARDS_TOOL } from '@/server/services/ai-prompts';
import { parseFlashcards } from '@/server/services/ai-utils';
import type { Tool } from '../types';

const params = z.object({
  concepts: z.array(z.object({
    term: z.string(),
    definition: z.string(),
    context: z.string().optional(),
    category: z.string().optional(),
  })),
  deckName: z.string().optional(),
  style: z.enum(['basic', 'detailed']).optional(),
  count: z.number().min(1).max(100).optional(),
});

export const flashcardCreateTool: Tool = {
  name: 'flashcard_create',
  description: 'Generate flashcards from a structured list of concepts. Each concept becomes one or more specific Q&A flashcards. Optionally specify the desired number of flashcards.',
  parameters: params,
  async execute(args, ctx) {
    const parsed = params.parse(args);
    ctx.callbacks?.onThinking?.(`Creating flashcards from ${parsed.concepts.length} concepts...`);

    const countLine = parsed.count ? `\nDesired number of flashcards: ${parsed.count}` : '';
    const prompt = `User request: ${ctx.state.text}${countLine}\n\nExtracted terms:\n${JSON.stringify(parsed.concepts, null, 2)}`;

    const result = await ctx.callLLM({
      prompt,
      systemPrompt: GENERATE_FROM_TERMS_SYSTEM_PROMPT,
      tools: [GENERATE_FLASHCARDS_TOOL],
      toolChoice: { type: 'function', function: { name: 'generate_flashcards' } },
      maxTokens: (ctx.state.metadata['flashcardMaxTokens'] as number) || 8192,
    });

    const toolCall = result.toolCalls?.find((tc) => tc.function.name === 'generate_flashcards');
    if (!toolCall) {
      return { deckName: 'AI Generated Flashcards', flashcards: [] };
    }

    let llmResult: { deck_name?: string; flashcards: unknown[] };
    try {
      llmResult = JSON.parse(toolCall.function.arguments);
    } catch {
      return { deckName: 'AI Generated Flashcards', flashcards: [] };
    }

    const flashcards = parseFlashcards(llmResult.flashcards);
    const deckName = String(llmResult.deck_name || parsed.deckName || 'AI Generated Flashcards');

    ctx.state.results['flashcards'] = flashcards;
    ctx.state.results['deckName'] = deckName;

    ctx.callbacks?.onFlashcards?.({ deckName, flashcards });

    return { deckName, flashcards };
  },
};
