import { tool, Output, generateText } from 'ai';
import { z } from '@/lib/zod';
import { chatModel } from '@/server/ai/model';
import { ANALYZE_SYSTEM_PROMPT } from '@/server/services/ai-prompts';

const termSchema = z.object({
  term: z.string(),
  definition: z.string(),
  context: z.string().optional(),
  category: z.string().optional(),
});

export const extractConceptsTool = tool({
  description:
    'Extract atomic, memorizable concepts from educational material. Returns a list of key terms with definitions.',
  inputSchema: z.object({
    material: z
      .string()
      .optional()
      .describe(
        'The educational material to extract concepts from. If not provided, uses material from previous steps.',
      ),
    maxTerms: z
      .number()
      .optional()
      .describe('Maximum number of terms to extract'),
  }),
  execute: async ({ material, maxTerms }) => {
    if (!material) {
      return { terms: [], error: 'No material provided' };
    }

    const truncated =
      material.length > 40000
        ? material.slice(0, 40000) + '\n\n[...content truncated for length]'
        : material;

    const maxNote = maxTerms ? ` Extract up to ${maxTerms} terms.` : '';

    const result = await generateText({
      model: chatModel,
      system: ANALYZE_SYSTEM_PROMPT + maxNote,
      prompt: truncated,
      output: Output.object({
        schema: z.object({
          terms: z.array(termSchema),
        }),
      }),
      maxOutputTokens: 32768,
      maxRetries: 3,
    });

    return { terms: result.output?.terms ?? [] };
  },
});
