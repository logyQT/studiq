import { tool } from 'ai';
import { conversationStorage } from '@/lib/conversation-context';
import { enqueueTrace } from '@/lib/trace-queue';
import { z } from '@/lib/zod';

export const askUserTool = tool({
  description: 'Ask the user a clarifying question when the request is ambiguous.',
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
    const cid = conversationStorage.getStore()?.conversationId;
    enqueueTrace({
      conversationId: cid,
      agentName: 'general',
      eventType: 'tool_call',
      label: 'ask_user',
      data: { question: question?.slice(0, 100), hasOptions: !!options?.length },
    });
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
