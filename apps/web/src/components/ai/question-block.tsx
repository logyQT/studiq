'use client';

import { useCallback } from 'react';

export interface QuestionBlockData {
  id: string;
  question: string;
  options?: { label: string; value: string }[];
}

interface QuestionBlockProps {
  question: QuestionBlockData;
  onAnswer: (text: string) => void;
}

export function QuestionBlock({ question, onAnswer }: QuestionBlockProps) {
  const handleOption = useCallback(
    (value: string) => {
      onAnswer(value);
    },
    [onAnswer],
  );

  return (
    <div className="mt-3 space-y-3">
      <p className="text-sm font-medium">{question.question}</p>

      {question.options && question.options.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {question.options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleOption(opt.label)}
              className="rounded-full border bg-background px-4 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">Or write your own answer below.</p>
    </div>
  );
}
