'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronRight, Sparkles } from 'lucide-react';

interface ThinkingBlockProps {
  traces: string[];
  isComplete: boolean;
}

export function ThinkingBlock({ traces, isComplete }: ThinkingBlockProps) {
  const t = useTranslations('AiChatPage');
  const [open, setOpen] = useState(false);

  if (traces.length === 0 && !isComplete) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
        <Sparkles className="h-3.5 w-3.5 animate-pulse" />
        <span className="italic">{t('thinking_title')}</span>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-lg border bg-background/40 text-xs">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-muted-foreground hover:text-foreground transition-colors"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Sparkles className="h-3 w-3" />
        <span className="font-medium">{t('thinking_title')}</span>
        {!isComplete && <span className="ml-auto flex gap-0.5"><span className="h-1 w-1 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: '0ms' }} /><span className="h-1 w-1 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: '150ms' }} /><span className="h-1 w-1 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: '300ms' }} /></span>}
      </button>
      {open && traces.length > 0 && (
        <div className="space-y-1 px-3 pb-2">
          {traces.map((trace, i) => (
            <div key={i} className="text-muted-foreground/80 whitespace-pre-wrap">
              {i > 0 && <span className="text-muted-foreground/40 text-[10px] block mb-0.5">step {i + 1}</span>}
              {trace}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
