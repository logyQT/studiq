import { z } from '@/lib/zod';
import { GENERATE_MATERIAL_PROMPT } from '@/server/services/ai-prompts';
import type { Tool } from '../types';

const params = z.object({
  topic: z.string(),
  depth: z.enum(['basic', 'detailed']).optional(),
  focusAreas: z.array(z.string()).optional(),
});

export const fetchMaterialTool: Tool = {
  name: 'fetch_material',
  description: 'Generate educational content on a topic. Creates comprehensive material suitable for creating flashcards, questions, or notes.',
  parameters: params,
  async execute(args, ctx) {
    const parsed = params.parse(args);

    const prompt = parsed.focusAreas?.length
      ? `Topic: ${parsed.topic}\nFocus areas: ${parsed.focusAreas.join(', ')}`
      : parsed.topic;

    const result = await ctx.callLLM({
      prompt,
      systemPrompt: GENERATE_MATERIAL_PROMPT,
      model: ctx.state.metadata['model'] as string,
      maxTokens: 8192,
    });

    ctx.state.material = result.content;
    ctx.state.results['material'] = result.content;

    return { content: result.content, length: result.content.length };
  },
};
