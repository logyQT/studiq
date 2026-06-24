import { z } from '@/lib/zod';
import { ANALYZE_SYSTEM_PROMPT, EXTRACT_TERMS_TOOL } from '@/server/services/ai-prompts';
import { parseExtractedTerms } from '@/server/services/ai-utils';
import type { Tool } from '../types';

const params = z.object({
  material: z.string().optional(),
  maxTerms: z.number().optional(),
});

export const extractConceptsTool: Tool = {
  name: 'extract_concepts',
  description:
    'Extract atomic, memorizable concepts from educational material. Pass maxTerms to control how many terms to extract (default 50-200). Returns a list of key terms with definitions.',
  parameters: params,
  async execute(args, ctx) {
    const parsed = params.parse(args);
    let material = parsed.material || ctx.state.material;
    if (!material) {
      return { terms: [], error: 'No material provided' };
    }

    if (material.length > 40000) {
      material = material.slice(0, 40000) + '\n\n[...content truncated for length]';
    }

    const maxTermsNote = parsed.maxTerms ? `\n\nExtract up to ${parsed.maxTerms} terms.` : '';
    const result = await ctx.callLLM({
      prompt: material,
      systemPrompt: ANALYZE_SYSTEM_PROMPT + maxTermsNote,
      tools: [EXTRACT_TERMS_TOOL],
      toolChoice: { type: 'function', function: { name: 'extract_terms' } },
      maxTokens: 32768,
    });

    const toolCall = result.toolCalls?.find((tc) => tc.function.name === 'extract_terms');
    if (!toolCall) {
      return { terms: [] };
    }

    const terms = parseExtractedTerms(toolCall.function.arguments);
    ctx.state.concepts = terms;
    ctx.state.results['concepts'] = terms;

    ctx.callbacks?.onThinking?.(`Found ${terms.length} key concepts`);

    return { terms };
  },
};
