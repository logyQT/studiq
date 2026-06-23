import { tool } from 'ai';
import { z } from '@/lib/zod';

export const askUserTool = tool({
  description:
    'Ask the user a clarifying question when the request is ambiguous.',
  inputSchema: z.object({
    question: z.string().describe('The question to ask the user'),
    options: z
      .array(
        z.object({
          label: z.string(),
          value: z.string(),
        }),
      )
      .optional()
      .describe('Available options for the user to choose from'),
  }),
  execute: async ({ question, options }) => {
    return {
      type: 'question' as const,
      question: {
        id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        question,
        options,
      },
    };
  },
});
