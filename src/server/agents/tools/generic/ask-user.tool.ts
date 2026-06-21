import { z } from '@/lib/zod';
import type { Tool } from '../types';

const params = z.object({
  question: z.string(),
  options: z.array(z.object({
    label: z.string(),
    value: z.string(),
  })).optional(),
});

export const askUserTool: Tool = {
  name: 'ask_user',
  description: 'Ask the user a clarifying question. Use this when the user\'s request is ambiguous or you need more information before proceeding.',
  parameters: params,
  async execute(args, _ctx) {
    const parsed = params.parse(args);
    const id = `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const question = { id, question: parsed.question, options: parsed.options };
    return { type: 'question', question };
  },
};
