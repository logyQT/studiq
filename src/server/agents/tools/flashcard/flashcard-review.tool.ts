import { z } from '@/lib/zod';
import { REVIEW_SYSTEM_PROMPT, REVIEW_CARDS_TOOL } from '@/server/services/ai-prompts';
import type { Tool } from '../types';

const params = z.object({
  cards: z.array(z.object({
    front: z.string(),
    back: z.string(),
    topic: z.string().optional(),
  })),
});

export const flashcardReviewTool: Tool = {
  name: 'flashcard_review',
  description: 'Evaluate flashcards for quality. Returns which cards pass quality criteria and keeps only the good ones.',
  parameters: params,
  async execute(args, ctx) {
    const parsed = params.parse(args);
    ctx.callbacks?.onThinking?.('Reviewing flashcards for quality...');

    const cardsJson = JSON.stringify(
      parsed.cards.map((c: { front: string; back: string; topic?: string }, i: number) => ({ index: i, front: c.front, back: c.back, topic: c.topic })),
      null, 2,
    );

    const result = await ctx.callLLM({
      prompt: cardsJson,
      systemPrompt: REVIEW_SYSTEM_PROMPT,
      tools: [REVIEW_CARDS_TOOL],
      toolChoice: { type: 'function', function: { name: 'review_cards' } },
      maxTokens: 2048,
    });

    const toolCall = result.toolCalls?.find((tc) => tc.function.name === 'review_cards');
    if (!toolCall) {
      return { kept: parsed.cards, dropped: [] };
    }

    let reviewResult: { kept: number[]; reasons?: Record<string, string> };
    try {
      reviewResult = JSON.parse(toolCall.function.arguments);
    } catch {
      return { kept: parsed.cards, dropped: [] };
    }

    const kept = reviewResult.kept?.map((i: number) => parsed.cards[i]).filter(Boolean) || [];
    const dropped = parsed.cards.filter((_: { front: string; back: string; topic?: string }, i: number) => !reviewResult.kept?.includes(i));

    const deckName = (ctx.state.results['deckName'] as string) || 'AI Generated Flashcards';

    ctx.state.results['flashcards'] = kept;
    if (dropped.length > 0) {
      ctx.callbacks?.onThinking?.(`Dropped ${dropped.length} low-quality flashcards`);
    }

    const passed = dropped.length === 0;

    return { kept, dropped, passed };
  },
};
