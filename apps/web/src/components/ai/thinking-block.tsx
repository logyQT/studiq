'use client';

import { Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { CollapsibleToggle } from '@/components/shared/collapsible-toggle';

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
      <CollapsibleToggle
        open={open}
        onToggle={() => setOpen(!open)}
        icon={<Sparkles className="h-3 w-3" />}
        label={t('thinking_title')}
        badge={
          !isComplete ? (
            <span className="flex gap-0.5">
              <span
                className="h-1 w-1 animate-bounce rounded-full bg-muted-foreground"
                style={{ animationDelay: '0ms' }}
              />
              <span
                className="h-1 w-1 animate-bounce rounded-full bg-muted-foreground"
                style={{ animationDelay: '150ms' }}
              />
              <span
                className="h-1 w-1 animate-bounce rounded-full bg-muted-foreground"
                style={{ animationDelay: '300ms' }}
              />
            </span>
          ) : undefined
        }
      />
      {open && traces.length > 0 && (
        <div className="space-y-1 px-3 pb-2">
          {traces.map((trace, i) => (
            <div key={i} className="text-muted-foreground/80 whitespace-pre-wrap">
              {i > 0 && (
                <span className="text-muted-foreground/40 text-[10px] block mb-0.5">
                  step {i + 1}
                </span>
              )}
              {trace}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
