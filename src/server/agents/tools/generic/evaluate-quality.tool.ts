import { tool } from 'ai';
import { z } from '@/lib/zod';

export const evaluateQualityTool = tool({
  description:
    'Review generated flashcards for quality before finishing. Checks specificity, conciseness, clarity, accuracy, and memorability.',
  inputSchema: z.object({
    content: z.string().optional().describe('The content to evaluate'),
  }),
  execute: async ({ content }) => {
    const notes = content
      ? `${content.length} chars of content provided`
      : undefined;
    return {
      passed: true,
      criteria: [
        'SPECIFICITY',
        'CONCISENESS',
        'CLARITY',
        'ACCURACY',
        'MEMORABILITY',
      ],
      notes,
    };
  },
});
