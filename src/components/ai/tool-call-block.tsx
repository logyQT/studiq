'use client';

import { Check, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { CollapsibleToggle } from '@/components/shared/collapsible-toggle';

interface ToolCallBlockProps {
  toolName: string;
  label: string;
  status: 'running' | 'complete';
  args?: unknown;
  result?: unknown;
  durationMs?: number;
}

export function ToolCallBlock({
  toolName: _toolName,
  label,
  status,
  args,
  result,
  durationMs,
}: ToolCallBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = status === 'running';

  return (
    <div className="mt-1 rounded-md border border-border/50 bg-muted/20 text-xs">
      <CollapsibleToggle
        compact
        open={expanded}
        onToggle={() => setExpanded(!expanded)}
        icon={
          isRunning ? (
            <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
          ) : (
            <Check className="h-3 w-3 shrink-0 text-green-600 dark:text-green-400" />
          )
        }
        label={label}
        badge={
          durationMs !== undefined ? (
            <span className="tabular-nums text-muted-foreground/60">
              {durationMs >= 1000 ? `${(durationMs / 1000).toFixed(1)}s` : `${durationMs}ms`}
            </span>
          ) : undefined
        }
      />
      {expanded && (
        <div className="space-y-1.5 px-3 pb-2">
          {args != null && (
            <div>
              <span className="text-muted-foreground/60">Args:</span>
              <pre className="mt-0.5 overflow-x-auto rounded bg-background/60 p-1.5 text-[10px] leading-relaxed">
                {JSON.stringify(args, null, 2)}
              </pre>
            </div>
          )}
          {result != null && (
            <div>
              <span className="text-muted-foreground/60">Result:</span>
              <pre className="mt-0.5 overflow-x-auto rounded bg-background/60 p-1.5 text-[10px] leading-relaxed">
                {JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
