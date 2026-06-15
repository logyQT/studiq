import { marked } from 'marked';
import TurndownService from 'turndown';

const turndownService = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  strongDelimiter: '**',
  linkStyle: 'inlined',
});

export function markdownToHtml(md: string): string {
  if (!md) return '';
  return marked.parse(md) as string;
}

export function htmlToMarkdown(html: string): string {
  if (!html) return '';
  return turndownService.turndown(html);
}
