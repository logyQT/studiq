import { z } from '@/lib/zod';
import { parseExtractedTerms } from '@/server/services/ai-utils';
import type { Tool } from '../types';

const params = z.object({
  topic: z.string(),
  count: z.number().min(5).max(50).optional(),
  categories: z.array(z.string()).optional(),
});

export const brainstormConceptsTool: Tool = {
  name: 'brainstorm_concepts',
  description: 'Ideate and brainstorm key concepts related to a topic. Useful when you need to identify what concepts exist before generating flashcards.',
  parameters: params,
  async execute(args, ctx) {
    const parsed = params.parse(args);
    ctx.callbacks?.onThinking?.(`Brainstorming concepts for "${parsed.topic}"...`);

    const prompt = parsed.categories?.length
      ? `Topic: ${parsed.topic}\nFocus categories: ${parsed.categories.join(', ')}\n\nList key concepts with definitions.`
      : `Topic: ${parsed.topic}\n\nList key concepts with definitions.`;

    const systemPrompt = `You are an educational content brainstormer. List ${parsed.count || 15} key concepts related to the given topic. Each concept must have a clear term and definition.`;

    const result = await ctx.callLLM({
      prompt,
      systemPrompt,
      tools: [{
        type: 'function',
        function: {
          name: 'brainstorm_output',
          description: 'Output brainstormed concepts',
          parameters: {
            type: 'object',
            properties: {
              terms: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    term: { type: 'string' },
                    definition: { type: 'string' },
                    category: { type: 'string' },
                  },
                  required: ['term', 'definition'],
                },
              },
            },
            required: ['terms'],
          },
        },
      }],
      toolChoice: { type: 'function', function: { name: 'brainstorm_output' } },
      maxTokens: 4096,
    });

    const toolCall = result.toolCalls?.find((tc) => tc.function.name === 'brainstorm_output');
    if (!toolCall) {
      return { concepts: [] };
    }

    const concepts = parseExtractedTerms(toolCall.function.arguments);
    ctx.state.concepts = concepts;
    ctx.state.results['concepts'] = concepts;

    return { concepts };
  },
};
