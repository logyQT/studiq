import { generateText, tool } from 'ai';
import { conversationStorage } from '@/lib/conversation-context';
import { enqueueTrace } from '@/lib/trace-queue';
import { z } from '@/lib/zod';
import { chatModel } from '@/server/ai/model';
import { GENERATE_MATERIAL_PROMPT } from '@/server/services/ai-prompts';

export const fetchMaterialTool = tool({
  description:
    'Generate educational content on a topic when the user did not provide material. Call this FIRST if you need content to work from.',
  inputSchema: z.object({
    topic: z.string().describe('The topic to generate content about'),
    depth: z
      .enum(['basic', 'moderate', 'advanced'])
      .optional()
      .describe('How detailed the content should be'),
    focusAreas: z.array(z.string()).optional().describe('Specific subtopics to focus on'),
  }),
  execute: async ({ topic, depth, focusAreas }) => {
    const cid = conversationStorage.getStore()?.conversationId;
    enqueueTrace({
      conversationId: cid,
      agentName: 'general',
      eventType: 'tool_call',
      label: 'fetch_material',
      data: { topic, depth, focusAreas },
    });

    const focusNote = focusAreas?.length ? `\nFocus on: ${focusAreas.join(', ')}` : '';
    const depthNote = depth ? `\nDepth level: ${depth}` : '';
    const prompt = `Topic: ${topic}${depthNote}${focusNote}`;

    const { text } = await generateText({
      model: chatModel,
      system: GENERATE_MATERIAL_PROMPT,
      prompt,
      maxRetries: 3,
    });

    return { content: text, length: text.length };
  },
});
