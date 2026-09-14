import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';

export function formatMarkdown(content: string): string {
  try {
    return String(
      unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkStringify, { bullet: '-', emphasis: '*' })
        .processSync(content),
    ).trimEnd();
  } catch {
    return content;
  }
}
