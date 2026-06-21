import { z } from '@/lib/zod';
import type { FlashcardItem } from '@/server/services/ai-utils';
import type { Tool, AgentResult, ToolContext } from '../types';

const params = z.object({
  agent: z.string(),
  task: z.string(),
  context: z.object({
    material: z.string().optional(),
    concepts: z.array(z.any()).optional(),
    count: z.number().min(1).max(1000).optional(),
    style: z.enum(['basic', 'detailed']).optional(),
  }).optional(),
});

export const callAgentTool: Tool = {
  name: 'call_agent',
  description: 'Delegate a subtask to a specialized sub-agent (e.g., "flashcard", "question", "notes"). The sub-agent has its own tools and expertise for the task.',
  parameters: params,
  async execute(args, ctx) {
    const parsed = params.parse(args);
    const agent = ctx.agentRegistry.get(parsed.agent);
    if (!agent) {
      return { type: 'error', error: `Agent "${parsed.agent}" not found` };
    }

    let subToolCount = 0;
    const wrappedCallbacks = {
      ...ctx.callbacks,
      onToolCall: () => { subToolCount++; },
      onToolResult: () => {},
      onThinking: (text: string) => {
        ctx.callbacks?.onThinking?.(`[${parsed.agent}] ${text}`);
      },
    };

    let concepts = parsed.context?.concepts;
    if (typeof concepts === 'string') {
      try {
        concepts = JSON.parse(concepts);
      } catch {
        concepts = undefined;
      }
    }

    const subState = {
      ...ctx.state,
      text: parsed.task,
      material: parsed.context?.material || ctx.state.material,
      concepts: concepts || ctx.state.concepts,
      metadata: {
        ...(ctx.state.metadata || {}),
        ...(parsed.context?.count ? { count: parsed.context.count } : {}),
        ...(parsed.context?.style ? { style: parsed.context.style } : {}),
      },
    };

    const agentExecute = agent as {
      execute(task: string, ctx: ToolContext): Promise<AgentResult>;
    };

    const result = await agentExecute.execute(parsed.task, { ...ctx, state: subState, callbacks: wrappedCallbacks });

    if (result.type === 'flashcards' && result.flashcards?.length) {
      const existing = (ctx.state.results['flashcards'] as FlashcardItem[]) || [];
      ctx.state.results['flashcards'] = [...existing, ...result.flashcards];
      ctx.state.results['deckName'] = result.deckName || 'Generated Flashcards';
    }

    return { ...result, toolCount: subToolCount, summary: `${parsed.agent} completed → ${subToolCount} tool calls executed` };
  },
};
