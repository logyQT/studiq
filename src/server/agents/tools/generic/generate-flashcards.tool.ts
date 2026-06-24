import { z } from '@/lib/zod';
import type { FlashcardItem, ExtractedTerm } from '@/server/services/ai-utils';
import { parseFlashcards } from '@/server/services/ai-utils';
import {
  GENERATE_FROM_TERMS_SYSTEM_PROMPT,
  GENERATE_FLASHCARDS_TOOL,
} from '@/server/services/ai-prompts';
import type { Tool } from '../types';

const BATCH_SIZE = 25;

const conceptSchema = z.object({
  term: z.string(),
  definition: z.string(),
  context: z.string().optional(),
  category: z.string().optional(),
});

const params = z.object({
  task: z.string(),
  concepts: z
    .preprocess((val) => {
      if (typeof val === 'string') {
        try {
          const p = JSON.parse(val);
          return Array.isArray(p) ? p : val;
        } catch {
          return val;
        }
      }
      return val;
    }, z.array(conceptSchema))
    .optional(),
  count: z.number().min(1).max(1000).optional(),
  concurrency: z.number().min(1).max(10).optional().default(3),
});

function balanceBatches(
  concepts: ExtractedTerm[],
  count?: number,
): { concepts: ExtractedTerm[]; count: number }[] {
  if (!concepts.length) return [];

  const numBatches = Math.ceil(concepts.length / BATCH_SIZE);
  const totalCount = count ?? concepts.length;
  const batches: { concepts: ExtractedTerm[]; count: number }[] = [];

  for (let i = 0; i < numBatches; i++) {
    const start = i * BATCH_SIZE;
    const end = Math.min(start + BATCH_SIZE, concepts.length);
    const batchConcepts = concepts.slice(start, end);
    const proportion = batchConcepts.length / concepts.length;
    const batchCount = Math.max(Math.round(totalCount * proportion), 1);
    batches.push({ concepts: batchConcepts, count: batchCount });
  }

  return batches;
}

async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
): Promise<T[]> {
  const results: T[] = [];
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export const generateFlashcardsTool: Tool = {
  name: 'generate_flashcards',
  description:
    'Generate flashcards from extracted concepts, or from LLM knowledge if no concepts provided. Pass ALL concepts and desired count — the tool splits into balanced batches of ~25 cards and distributes proportionally. Can be called with just task + count (no concepts) for knowledge-based generation.',
  parameters: params,
  async execute(args, ctx) {
    const parsed = params.parse(args);

    let batchFns: (() => Promise<{ flashcards: FlashcardItem[]; deckName?: string }>)[];

    if (!parsed.concepts?.length) {
      const countLine = parsed.count ? `\nDesired number of flashcards: ${parsed.count}` : '';
      batchFns = [
        async () => {
          const prompt = `User request: ${parsed.task}${countLine}\n\nGenerate flashcards directly based on your knowledge of this topic — no extracted terms provided.`;
          const result = await ctx.callLLM({
            prompt,
            systemPrompt: GENERATE_FROM_TERMS_SYSTEM_PROMPT,
            tools: [GENERATE_FLASHCARDS_TOOL],
            toolChoice: { type: 'function', function: { name: 'generate_flashcards' } },
            maxTokens: 32768,
          });
          const toolCall = result.toolCalls?.find(
            (tc) => tc.function.name === 'generate_flashcards',
          );
          if (!toolCall) return { flashcards: [] };
          try {
            const llmResult = JSON.parse(toolCall.function.arguments);
            return {
              flashcards: parseFlashcards(llmResult.flashcards ?? []),
              deckName: String(llmResult.deck_name ?? 'Generated Flashcards'),
            };
          } catch {
            return { flashcards: [] };
          }
        },
      ];
    } else {
      const balanced = balanceBatches(parsed.concepts, parsed.count);
      batchFns = balanced.map((b) => async () => {
        const countLine = b.count ? `\nDesired number of flashcards: ${b.count}` : '';
        const prompt = `User request: ${parsed.task}${countLine}\n\nExtracted terms:\n${JSON.stringify(b.concepts, null, 2)}`;
        const result = await ctx.callLLM({
          prompt,
          systemPrompt: GENERATE_FROM_TERMS_SYSTEM_PROMPT,
          tools: [GENERATE_FLASHCARDS_TOOL],
          toolChoice: { type: 'function', function: { name: 'generate_flashcards' } },
          maxTokens: 16384,
        });
        const toolCall = result.toolCalls?.find((tc) => tc.function.name === 'generate_flashcards');
        if (!toolCall) return { flashcards: [] as FlashcardItem[] };
        try {
          const llmResult = JSON.parse(toolCall.function.arguments);
          return {
            flashcards: parseFlashcards(llmResult.flashcards ?? []),
            deckName: String(llmResult.deck_name ?? 'AI Generated Flashcards'),
          };
        } catch {
          return { flashcards: [] as FlashcardItem[] };
        }
      });
    }

    const results = await runWithConcurrency(batchFns, parsed.concurrency);
    const allFlashcards = results.flatMap((r) => r.flashcards);
    const deckName = results.find((r) => r.deckName)?.deckName || 'Generated Flashcards';
    ctx.state.results['flashcards'] = allFlashcards;
    ctx.state.results['deckName'] = deckName;
    return {
      type: 'flashcards' as const,
      deckName,
      flashcards: allFlashcards,
      batchCount: results.length,
      summary: `Generated ${allFlashcards.length} flashcards across ${results.length} batches`,
    };
  },
};
