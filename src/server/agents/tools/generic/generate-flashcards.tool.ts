import { tool, Output, generateText } from 'ai';
import { z } from '@/lib/zod';
import { chatModel } from '@/server/ai/model';
import { parseFlashcards } from '@/server/services/ai-utils';
import type { ExtractedTerm } from '@/server/services/ai-utils';

const BATCH_SIZE = 25;

const conceptSchema = z.object({
  term: z.string(),
  definition: z.string(),
  context: z.string().optional(),
  category: z.string().optional(),
});

const flashcardSchema = z.object({
  front: z.string(),
  back: z.string(),
  topic: z.string().optional(),
});

const outputSchema = z.object({
  deck_name: z.string(),
  flashcards: z.array(flashcardSchema),
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

export const generateFlashcardsTool = tool({
  description:
    'Generate flashcards from extracted concepts, or from LLM knowledge if no concepts provided. Pass ALL concepts and desired count. After this tool succeeds, call finish immediately.',
  inputSchema: z.object({
    task: z.string().describe('The user request or topic for flashcards'),
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
    count: z
      .number()
      .min(1)
      .max(1000)
      .optional()
      .describe('Desired number of flashcards'),
    concurrency: z
      .number()
      .min(1)
      .max(10)
      .optional()
      .default(3),
  }),
  execute: async ({ task, concepts, count, concurrency }) => {
    async function generateBatch(
      prompt: string,
      desiredCount: number,
    ): Promise<{ flashcards: any[]; deckName?: string }> {
      const countLine = desiredCount
        ? `\nGenerate exactly ${desiredCount} flashcards.`
        : '';
      const result = await generateText({
        model: chatModel,
        system:
          'You are a flashcard generator. Create specific, concise flashcards — one concept per card.',
        prompt: `${prompt}${countLine}`,
        output: Output.object({ schema: outputSchema }),
        maxOutputTokens: 32768,
        maxRetries: 3,
      });
      const output = result.output;
      return {
        flashcards: parseFlashcards(output?.flashcards ?? []),
        deckName: output?.deck_name ?? 'Generated Flashcards',
      };
    }

    let batches: Array<{
      concepts: ExtractedTerm[];
      count: number;
    }>;

    if (!concepts?.length) {
      batches = [
        { concepts: [], count: count ?? 10 },
      ];
    } else {
      batches = balanceBatches(concepts, count);
    }

    const results = await Promise.all(
      batches.map((batch) =>
        (async () => {
          const termsInfo = batch.concepts.length
            ? `\nConcepts to base flashcards on:\n${JSON.stringify(batch.concepts, null, 2)}`
            : '';
          return generateBatch(
            `User request: ${task}${termsInfo}`,
            batch.count,
          );
        })(),
      ),
    );

    const allFlashcards = results.flatMap((r) => r.flashcards);
    const deckName =
      results.find((r) => r.deckName)?.deckName || 'Generated Flashcards';

    return {
      type: 'flashcards' as const,
      deckName,
      flashcards: allFlashcards,
      summary: `Generated ${allFlashcards.length} flashcards`,
    };
  },
});
