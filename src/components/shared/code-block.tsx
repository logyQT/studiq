'use client';

import { Check, Copy } from 'lucide-react';
import { type ReactNode, useState } from 'react';

interface CodeBlockProps {
  children: ReactNode;
  rawCode: string;
  language?: string;
}

export function CodeBlock({ children, rawCode, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(rawCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      className="my-2 overflow-hidden rounded-lg border bg-muted/50 text-left"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b px-4 py-1.5">
        {language ? (
          <span className="text-xs font-medium text-muted-foreground">{language}</span>
        ) : (
          <span />
        )}
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          title="Copy code"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="overflow-x-auto p-4">
        <code className="text-sm font-mono">{children}</code>
      </pre>
    </div>
  );
}
