import { z } from '@/lib/zod';
import type { FlashcardItem, ExtractedTerm } from '@/server/services/ai-utils';
import { parseFlashcards } from '@/server/services/ai-utils';
import { GENERATE_FROM_TERMS_SYSTEM_PROMPT, GENERATE_FLASHCARDS_TOOL } from '@/server/services/ai-prompts';
import type { Tool, AgentResult, ToolContext } from '../types';

const BATCH_SIZE = 25;

const conceptSchema = z.object({
  term: z.string(),
  definition: z.string(),
  context: z.string().optional(),
  category: z.string().optional(),
});

const params = z.object({
  agent: z.string(),
  task: z.string(),
  concepts: z.preprocess((val) => {
    if (typeof val === 'string') {
      try { const p = JSON.parse(val); return Array.isArray(p) ? p : val; }
      catch { return val; }
    }
    return val;
  }, z.array(conceptSchema)).optional(),
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

export const callAgentsTool: Tool = {
  name: 'call_agents',
  description: 'Dispatch one or more sub-agents (e.g., "flashcard") to generate content. Provide concepts and the tool auto-splits them into balanced batches of ~25 each. Just say what agent, what task, and what concepts — no need to split manually.',
  parameters: params,
  async execute(args, ctx) {
    const parsed = params.parse(args);

    // PIPELINE mode: when concepts are provided, direct LLM call per batch,
    // no sub-agent LLM orchestration. Deterministic, reliable.
    if (parsed.concepts?.length) {
      const balanced = balanceBatches(parsed.concepts, parsed.count);
      const batchFns = balanced.map((b) => async () => {
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
    }

    // LEGACY mode: sub-agent dispatch for task-only calls (no concepts)
    const balanced = balanceBatches(parsed.concepts ?? [], parsed.count);
    const batches = balanced.length
      ? balanced.map((b, i) => ({
          agent: parsed.agent,
          task: `${parsed.task} (Batch ${i + 1}/${balanced.length} — ${b.concepts.length} concepts, aim for ${b.count} cards)\n\nConcepts:\n${JSON.stringify(b.concepts, null, 2)}`,
          concepts: b.concepts,
          count: b.count,
        }))
      : [{ agent: parsed.agent, task: parsed.task, concepts: parsed.concepts ?? [], count: parsed.count }];

    const taskFns = batches.map((batch) => async () => {
      const agent = ctx.agentRegistry.get(batch.agent);
      if (!agent) {
        return { agent: batch.agent, result: { type: 'error' as const, error: `Agent "${batch.agent}" not found` } };
      }

      const subState = {
        ...ctx.state,
        text: batch.task,
        concepts: batch.concepts,
        metadata: { ...(ctx.state.metadata || {}), count: batch.count },
      };

      const wrappedCallbacks = {
        ...ctx.callbacks,
        onToolCall: () => {},
        onToolResult: () => {},
        onThinking: () => {},
      };

      const result = await (agent as { execute(task: string, ctx: ToolContext): Promise<AgentResult> })
        .execute(batch.task, { ...ctx, state: subState, callbacks: wrappedCallbacks });
      return { agent: batch.agent, result };
    });

    const results = await runWithConcurrency(taskFns, parsed.concurrency);

    const allFlashcards: FlashcardItem[] = [];
    let deckName = 'Generated Flashcards';
    for (const { result } of results) {
      if (result.type === 'flashcards' && result.flashcards?.length) {
        allFlashcards.push(...result.flashcards);
        if (result.deckName) deckName = result.deckName;
      }
    }

    ctx.state.results['flashcards'] = allFlashcards;
    ctx.state.results['deckName'] = deckName;

    if (allFlashcards.length) {
      return {
        type: 'flashcards' as const,
        deckName,
        flashcards: allFlashcards,
        batchCount: results.length,
        summary: `Generated ${allFlashcards.length} flashcards across ${results.length} batches`,
      };
    }

    const firstResult = results[0]?.result;
    if (firstResult?.type === 'flashcards') return firstResult;
    if (firstResult?.type === 'chat') return firstResult;
    if (firstResult?.type === 'question') return firstResult;
    return { type: 'error' as const, error: 'No results from sub-agents' };
  },
};
