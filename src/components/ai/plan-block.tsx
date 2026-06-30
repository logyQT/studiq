'use client';

import { ChevronDown, ChevronRight, ListChecks, Sparkles } from 'lucide-react';
import { useState } from 'react';

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
}

export function PlanBlock({ steps, estimatedComplexity, isComplete }: PlanBlockProps) {
  const [open, setOpen] = useState(true);

  return (
    <div className="mt-2 rounded-lg border bg-background/40 text-xs">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-muted-foreground hover:text-foreground transition-colors"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        <ListChecks className="h-3.5 w-3.5 shrink-0" />
        <span className="font-medium">Execution Plan ({steps.length} steps)</span>
        {estimatedComplexity && (
          <span className="text-muted-foreground/50 ml-1">· {estimatedComplexity}</span>
        )}
        {isComplete && (
          <span className="ml-auto text-green-600 dark:text-green-400 font-medium">
            All steps complete
          </span>
        )}
      </button>
      {open && (
        <div className="space-y-1.5 px-3 pb-2.5">
          {steps.map((step) => (
            <div key={step.index} className="flex gap-2 text-muted-foreground/80">
              <span className="mt-0.5 shrink-0">
                {isComplete ? (
                  <Sparkles className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                ) : (
                  <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-muted-foreground/30 text-[9px] font-medium text-muted-foreground/50">
                    {step.index + 1}
                  </span>
                )}
              </span>
              <div className="min-w-0">
                <div className="font-medium text-foreground/80">{step.action}</div>
                <div className="text-muted-foreground/60 mt-0.5 leading-relaxed">
                  {step.rationale}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
