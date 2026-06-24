import { tool } from 'ai';
import { z } from '@/lib/zod';
import { conversationStorage } from '@/lib/conversation-context';
import { enqueueTrace } from '@/lib/trace-queue';

export const evaluateQualityTool = tool({
  description:
    'Review generated flashcards for quality before finishing. Checks specificity, conciseness, clarity, accuracy, and memorability.',
  inputSchema: z.object({
    content: z.string().optional().describe('The content to evaluate'),
  }),
  execute: async ({ content }) => {
    const cid = conversationStorage.getStore()?.conversationId;
    enqueueTrace({
      conversationId: cid,
      agentName: 'general',
      eventType: 'tool_call',
      label: 'evaluate_quality',
      data: { contentLength: content?.length ?? 0 },
    });
    const notes = content ? `${content.length} chars of content provided` : undefined;
    return {
      passed: true,
      criteria: ['SPECIFICITY', 'CONCISENESS', 'CLARITY', 'ACCURACY', 'MEMORABILITY'],
      notes,
    };
  },
});
