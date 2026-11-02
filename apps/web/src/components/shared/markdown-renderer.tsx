'use client';

import Image from 'next/image';
import { memo, type ReactNode } from 'react';
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { CodeBlock } from '@/components/shared/code-block';
// eslint-disable-next-line import/no-unassigned-import -- side-effect import: KaTeX stylesheet required for rendered math.
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

type MarkdownElementProps<T extends keyof React.JSX.IntrinsicElements> =
  React.JSX.IntrinsicElements[T] & ExtraProps;

function extractText(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (node == null || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(extractText).join('');
  const el = node as React.ReactElement<{ children?: ReactNode }>;
  if (typeof node === 'object' && el.props) return extractText(el.props.children);
  return '';
}

function MarkdownH1({ children }: MarkdownElementProps<'h1'>) {
  return <h1 className="text-2xl font-bold mt-4 mb-2">{children}</h1>;
}

function MarkdownH2({ children }: MarkdownElementProps<'h2'>) {
  return <h2 className="text-xl font-bold mt-3 mb-1.5">{children}</h2>;
}

function MarkdownH3({ children }: MarkdownElementProps<'h3'>) {
  return <h3 className="text-lg font-semibold mt-3 mb-1">{children}</h3>;
}

function MarkdownH4({ children }: MarkdownElementProps<'h4'>) {
  return <h4 className="text-base font-semibold mt-2 mb-1">{children}</h4>;
}

function MarkdownH5({ children }: MarkdownElementProps<'h5'>) {
  return <h5 className="text-sm font-semibold mt-2 mb-1">{children}</h5>;
}

function MarkdownH6({ children }: MarkdownElementProps<'h6'>) {
  return <h6 className="text-sm font-medium mt-2 mb-1 text-muted-foreground">{children}</h6>;
}

function MarkdownParagraph({ children }: MarkdownElementProps<'p'>) {
  return <div className="mb-1 last:mb-0">{children}</div>;
}

function MarkdownUnorderedList({ children }: MarkdownElementProps<'ul'>) {
  return <ul className="list-disc pl-8 mb-1 last:mb-0 text-left">{children}</ul>;
}

function MarkdownOrderedList({ children }: MarkdownElementProps<'ol'>) {
  return <ol className="list-decimal pl-8 mb-1 last:mb-0 text-left">{children}</ol>;
}

function MarkdownListItem({ children }: MarkdownElementProps<'li'>) {
  return <li className="mb-0.5 last:mb-0">{children}</li>;
}

function MarkdownPre({ children }: MarkdownElementProps<'pre'>) {
  return <>{children}</>;
}

function MarkdownCode({ className: codeClassName, children }: MarkdownElementProps<'code'>) {
  const isFenced = /language-\w+/.test(codeClassName ?? '');
  if (isFenced) {
    const language = codeClassName?.replace('language-', '');
    return (
      <CodeBlock language={language} rawCode={extractText(children)}>
        {children}
      </CodeBlock>
    );
  }
  return <code className="rounded bg-black/10 px-1 py-0.5 text-sm font-mono">{children}</code>;
}

function MarkdownStrong({ children }: MarkdownElementProps<'strong'>) {
  return <strong className="font-semibold">{children}</strong>;
}

function MarkdownEmphasis({ children }: MarkdownElementProps<'em'>) {
  return <em>{children}</em>;
}

function MarkdownBlockquote({ children }: MarkdownElementProps<'blockquote'>) {
  return (
    <blockquote className="border-l-2 border-muted-foreground/30 pl-3 italic mb-1 last:mb-0 text-left">
      {children}
    </blockquote>
  );
}

function MarkdownAnchor({ href, children }: MarkdownElementProps<'a'>) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2"
    >
      {children}
    </a>
  );
}

function MarkdownTable({ children }: MarkdownElementProps<'table'>) {
  return (
    <div className="overflow-x-auto mb-1 last:mb-0 text-left">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

function MarkdownTableHead({ children }: MarkdownElementProps<'th'>) {
  return (
    <th className="border border-border bg-muted px-3 py-1.5 text-left font-medium">{children}</th>
  );
}

function MarkdownTableCell({ children }: MarkdownElementProps<'td'>) {
  return <td className="border border-border px-3 py-1.5">{children}</td>;
}

function MarkdownDeleted({ children }: MarkdownElementProps<'del'>) {
  return <del className="line-through">{children}</del>;
}

function MarkdownImage({ src, alt }: MarkdownElementProps<'img'>) {
  if (!src) return null;
  return (
    <div className="relative max-w-full h-48 mx-auto">
      <Image
        src={src as string}
        alt={alt ?? ''}
        fill
        className="object-contain rounded-lg"
        sizes="(max-width: 768px) 100vw, 768px"
      />
    </div>
  );
}

function MarkdownRule() {
  return <hr className="my-2 border-border" />;
}

function MarkdownAudio({ src }: MarkdownElementProps<'audio'>) {
  if (typeof src !== 'string') return null;
  return (
    // User-authored markdown media has no caption file to point a <track> at.
    // eslint-disable-next-line jsx-a11y/media-has-caption -- see above.
    <audio controls src={src} className="w-full min-w-96 h-9 my-2 rounded-lg" />
  );
}

const markdownComponents: Components = {
  h1: MarkdownH1,
  h2: MarkdownH2,
  h3: MarkdownH3,
  h4: MarkdownH4,
  h5: MarkdownH5,
  h6: MarkdownH6,
  p: MarkdownParagraph,
  ul: MarkdownUnorderedList,
  ol: MarkdownOrderedList,
  li: MarkdownListItem,
  pre: MarkdownPre,
  code: MarkdownCode,
  strong: MarkdownStrong,
  em: MarkdownEmphasis,
  blockquote: MarkdownBlockquote,
  a: MarkdownAnchor,
  table: MarkdownTable,
  th: MarkdownTableHead,
  td: MarkdownTableCell,
  del: MarkdownDeleted,
  img: MarkdownImage,
  hr: MarkdownRule,
  audio: MarkdownAudio,
};

function MarkdownRendererContent({ content, className }: MarkdownRendererProps) {
  return (
    <div className={`overflow-hidden break-words whitespace-normal ${className ?? ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, rehypeHighlight, [rehypeSanitize, sanitizeSchema], rehypeKatex]}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export const MarkdownRenderer = memo(MarkdownRendererContent);
