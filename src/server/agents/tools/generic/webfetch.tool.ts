import { z } from '@/lib/zod';
import type { Tool } from '../types';

const params = z.object({
  url: z.string().url(),
});

export const webfetchTool: Tool = {
  name: 'webfetch',
  description: 'Fetch and extract text content from a URL. Use this when the user provides a webpage URL to create study material from its content.',
  parameters: params,
  async execute(args, ctx) {
    const parsed = params.parse(args);


    let text: string;
    try {
      const res = await fetch(parsed.url);
      if (!res.ok) {
        return { content: '', error: `HTTP ${res.status}: ${res.statusText}`, url: parsed.url };
      }
      text = await res.text();
    } catch (err) {
      return { content: '', error: `Fetch failed: ${err instanceof Error ? err.message : 'Unknown error'}`, url: parsed.url };
    }

    ctx.state.material = text;
    ctx.state.results['material'] = text;
    ctx.state.results['sourceUrl'] = parsed.url;

    return { content: text, url: parsed.url, length: text.length };
  },
};
