'use client';

import { ListChecks, Loader2, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { CollapsibleToggle } from '@/components/shared/collapsible-toggle';
import { cn } from '@/lib/utils';

interface PlanStep {
  index: number;
  action: string;
  rationale: string;
  dependsOn?: string[];
}

interface PlanBlockProps {
  steps: PlanStep[];
  estimatedComplexity?: string;
  isComplete: boolean;
  completedSteps?: number[];
}

export function PlanBlock({
  steps,
  estimatedComplexity,
  isComplete,
  completedSteps,
}: PlanBlockProps) {
  const [open, setOpen] = useState(true);
  const completed = new Set(completedSteps ?? []);
  const nextPending = [...Array(steps.length).keys()].find((i) => !completed.has(i));

  return (
    <div className="mt-2 rounded-lg border bg-background/40 text-xs">
      <CollapsibleToggle
        open={open}
        onToggle={() => setOpen(!open)}
        icon={<ListChecks className="h-3.5 w-3.5 shrink-0" />}
        label={
          <>
            Execution Plan ({steps.length} steps)
            {estimatedComplexity && (
              <span className="text-muted-foreground/50 ml-1">· {estimatedComplexity}</span>
            )}
          </>
        }
        badge={
          <span className="text-muted-foreground/60">
            {isComplete ? 'All steps complete' : `${completed.size} / ${steps.length} completed`}
          </span>
        }
      />
      {open && (
        <div className="space-y-1.5 px-3 pb-2.5">
          {steps.map((step) => {
            const isStepCompleted = completed.has(step.index);
            const isInProgress = step.index === nextPending && !isComplete;
            return (
              <div
                key={step.index}
                className={cn(
                  'flex gap-2',
                  isStepCompleted ? 'text-muted-foreground/60' : 'text-muted-foreground/80',
                )}
              >
                <span className="mt-0.5 shrink-0">
                  {isStepCompleted ? (
                    <Sparkles className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                  ) : isInProgress ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  ) : (
                    <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-muted-foreground/30 text-[9px] font-medium text-muted-foreground/50">
                      {step.index + 1}
                    </span>
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      'font-medium',
                      isStepCompleted ? 'text-muted-foreground/60' : 'text-foreground/80',
                    )}
                  >
                    {step.action}
                  </div>
                  <div className="text-muted-foreground/60 mt-0.5 leading-relaxed">
                    {step.rationale}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
