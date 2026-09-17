import { conversationStorage } from '@studiq/server/lib/conversation-context';
import { enqueueTrace } from '@studiq/server/lib/trace-queue';
import { z } from '@studiq/server/lib/zod';
import { tool } from 'ai';

const termSchema = z.object({
  term: z.string(),
  definition: z.string(),
  context: z.string().optional(),
  category: z.string().optional(),
});

export const extractConceptsTool = tool({
  description:
    'Extract key terms and definitions from educational material. Pass the material and the model returns structured terms with definitions.',
  inputSchema: z.object({
    material: z.string().describe('The educational material to analyze'),
    maxTerms: z.number().optional().describe('Maximum number of terms to extract'),
    terms: z.array(termSchema).describe('The extracted terms with definitions'),
  }),
  execute: async ({ terms }) => {
    const cid = conversationStorage.getStore()?.conversationId;
    enqueueTrace({
      conversationId: cid,
      agentName: 'general',
      eventType: 'tool_call',
      label: 'extract_concepts',
      data: { termCount: terms?.length },
    });
    return { terms };
  },
});
