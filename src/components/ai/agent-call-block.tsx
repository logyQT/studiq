'use client';

import { Check, Loader2 } from 'lucide-react';

interface AgentCallBlockProps {
  agentName: string;
  status: 'running' | 'complete';
  subTask?: string;
  toolCount?: number;
}

export function AgentCallBlock({ agentName, status, subTask, toolCount }: AgentCallBlockProps) {
  const isRunning = status === 'running';

  return (
    <div className="mt-1 rounded-md border border-border/50 bg-muted/20 text-xs">
      <div className="flex items-center gap-1.5 px-3 py-1.5 text-muted-foreground">
        {isRunning ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
        ) : (
          <Check className="h-3 w-3 shrink-0 text-green-600 dark:text-green-400" />
        )}
        <span className="font-medium">🤖 {agentName}</span>
        {!isRunning && toolCount !== undefined && (
          <span className="text-muted-foreground/60 ml-1">
            · {toolCount} tool call{toolCount !== 1 ? 's' : ''} executed
          </span>
        )}
        {isRunning && (
          <span className="ml-auto flex gap-0.5">
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
        )}
      </div>
      {isRunning && subTask && (
        <div className="px-3 pb-1.5 text-[10px] text-muted-foreground/60 flex items-center gap-1">
          <span>{subTask}</span>
        </div>
      )}
    </div>
  );
}
