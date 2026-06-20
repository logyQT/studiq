import { z } from '@/lib/zod';
import type { Tool } from '../types';

const params = z.object({
  text: z.string(),
});

export const chatTool: Tool = {
  name: 'chat',
  description: 'Respond conversationally to the user. Use this when the user is making small talk, greeting, asking a general question, or when no educational content generation is needed.',
  parameters: params,
  async execute(args, ctx) {
    const parsed = params.parse(args);
    if (parsed.text) {
      for (let i = 0; i < parsed.text.length; i += 50) {
        ctx.callbacks?.onToken?.(parsed.text.slice(i, i + 50));
      }
    }
    return { type: 'chat', content: parsed.text };
  },
};
