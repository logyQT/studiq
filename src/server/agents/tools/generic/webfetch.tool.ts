import { tool } from 'ai';
import { z } from '@/lib/zod';

export const webfetchTool = tool({
  description: 'Fetch content from a URL the user provides.',
  inputSchema: z.object({
    url: z.string().url().describe('The URL to fetch content from'),
  }),
  execute: async ({ url }) => {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        return {
          content: '',
          error: `HTTP ${res.status}: ${res.statusText}`,
          url,
          length: 0,
        };
      }
      const content = await res.text();
      return { content, url, length: content.length };
    } catch (error) {
      return {
        content: '',
        error: `Fetch failed: ${error instanceof Error ? error.message : String(error)}`,
        url,
        length: 0,
      };
    }
  },
});
