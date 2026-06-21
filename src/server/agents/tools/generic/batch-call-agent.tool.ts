import { z } from '@/lib/zod';
import type { Tool, AgentResult, ToolContext } from '../types';
import type { FlashcardItem } from '@/server/services/ai-utils';

const batchParams = z.object({
  batches: z.array(z.object({
    agent: z.string(),
    task: z.string(),
    concepts: z.array(z.object({
      term: z.string(),
      definition: z.string(),
      context: z.string().optional(),
      category: z.string().optional(),
    })).optional(),
    count: z.number().min(1).max(25).optional(),
  })).min(1).max(20),
  concurrency: z.number().min(1).max(10).optional().default(3),
});

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

export const batchCallAgentTool: Tool = {
  name: 'batch_call_agent',
  description: 'Dispatch multiple sub-agents with controlled concurrency. Each batch runs independently within the concurrency limit. Results are combined. Best for splitting large flashcard generation into 20-25 card batches.',
  parameters: batchParams,
  async execute(args, ctx) {
    const parsed = batchParams.parse(args);

    const taskFns = parsed.batches.map((batch) => async () => {
      const agent = ctx.agentRegistry.get(batch.agent);
      if (!agent) {
        return { agent: batch.agent, result: { type: 'error' as const, error: `Agent "${batch.agent}" not found` } };
      }

      let _subToolCount = 0;
      const wrappedCallbacks = {
        ...ctx.callbacks,
        onToolCall: () => { _subToolCount++; },
        onToolResult: () => {},
        onThinking: (text: string) => {
          ctx.callbacks?.onThinking?.(`[batch] ${text}`);
        },
      };

      const subState = {
        ...ctx.state,
        text: batch.task,
        concepts: batch.concepts || [],
        metadata: { ...(ctx.state.metadata || {}), count: batch.count || 25 },
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

    return {
      type: 'flashcards',
      deckName,
      flashcards: allFlashcards,
      toolCount: parsed.batches.length,
      summary: `Generated ${allFlashcards.length} flashcards across ${parsed.batches.length} parallel agents (concurrency: ${parsed.concurrency})`,
    };
  },
};
