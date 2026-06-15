'use client';

import { type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeHighlight from 'rehype-highlight';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { AudioPlayer } from '@/components/shared/audio-player';
import { CodeBlock } from '@/components/shared/code-block';
import 'katex/dist/katex.min.css';

const sanitizeSchema = structuredClone(defaultSchema);
sanitizeSchema.tagNames!.push('audio');
sanitizeSchema.attributes!.audio = ['src', 'controls'];
sanitizeSchema.attributes!.span = [
  ...(sanitizeSchema.attributes!.span || []),
  ['className', 'math', 'math-inline', 'math-display', /^hljs-/],
];
sanitizeSchema.attributes!.div = [
  ...(sanitizeSchema.attributes!.div || []),
  ['className', 'math', 'math-display'],
];

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

function extractText(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (node == null || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (node && typeof node === 'object' && 'props' in node) return extractText((node as React.ReactElement).props.children);
  return '';
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, rehypeHighlight, [rehypeSanitize, sanitizeSchema], rehypeKatex]}
        components={{
          p: ({ children }) => <div className="mb-1 last:mb-0">{children}</div>,
          ul: ({ children }) => <ul className="list-disc pl-4 mb-1 last:mb-0 text-left">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-4 mb-1 last:mb-0 text-left">{children}</ol>,
          li: ({ children }) => <li className="mb-0.5 last:mb-0">{children}</li>,
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children }) => {
            const isFenced = /language-\w+/.test(className ?? '');
            if (isFenced) {
              const language = className?.replace('language-', '');
              return <CodeBlock language={language} rawCode={extractText(children)}>{children}</CodeBlock>;
            }
            return <code className="rounded bg-black/10 px-1 py-0.5 text-sm font-mono">{children}</code>;
          },
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em>{children}</em>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-muted-foreground/30 pl-3 italic mb-1 last:mb-0 text-left">
              {children}
            </blockquote>
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto mb-1 last:mb-0 text-left">
              <table className="w-full border-collapse text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-border bg-muted px-3 py-1.5 text-left font-medium">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border border-border px-3 py-1.5">{children}</td>
          ),
          del: ({ children }) => <del className="line-through">{children}</del>,
          img: ({ src, alt }) =>
            src ? <img src={src} alt={alt ?? ''} className="block max-w-full h-auto rounded-lg mx-auto" /> : null,
          hr: () => <hr className="my-2 border-border" />,
          audio: ({ src }) =>
            typeof src === 'string' ? <AudioPlayer src={src} /> : null,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
