'use client';

import { Check, Minus, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import type {
  QuizDemoResult,
  QuizDemoStatus,
} from '@/components/marketing/previews/quiz-demo-result';
import {
  QuizScoreSummary,
  type QuizScoreSummaryLabels,
} from '@/components/quiz/quiz-score-summary';

export interface QuizResultPreviewLabels {
  /** The primary action: it leaves the demo for the real product. */
  cta: string;
  restart: string;
}

export interface QuizResultPreviewProps {
  result: QuizDemoResult;
  locale: string;
  labels: QuizResultPreviewLabels;
  scoreLabels: QuizScoreSummaryLabels;
  /** Per-row wording; the glyph is `aria-hidden`, the state travels as text. */
  statusLabels: Record<QuizDemoStatus, string>;
  onRestart: () => void;
}

const STATUS_MARK = {
  correct: <Check className="size-4 shrink-0 text-success" aria-hidden />,
  wrong: <X className="size-4 shrink-0 text-destructive" aria-hidden />,
  // Skipped is quieter than wrong: the visitor may simply have stepped past it.
  skipped: <Minus className="size-4 shrink-0 text-muted-foreground" aria-hidden />,
} as const;

/**
 * What the demo shows once Finish is pressed: the visitor's own result, in the
 * product's score line, with one row per question they were asked.
 *
 * The score is real — `result` is graded from the four answers they gave — so
 * nothing here withholds or decorates it. The body follows one left axis: the
 * score at the top, the questions in the middle, the actions anchored to the
 * bottom of the card, all at the card's own content inset. Neither action is a
 * `signal` fill; the hero's CTA is the page's one lime action (DESIGN.md
 * §Dosage).
 *
 * The rows are a record, not a link: there is no review page behind the demo, so
 * they carry no pointer, no hover and no focus. Truncation is visual only — the
 * whole stem is in the DOM, so a screen reader never gets the cut-off version.
 */
export function QuizResultPreview({
  result,
  locale,
  labels,
  scoreLabels,
  statusLabels,
  onRestart,
}: QuizResultPreviewProps) {
  const resultRef = useRef<HTMLDivElement>(null);

  /*
   * Finish removes the control the visitor just pressed, so focus follows the
   * content: the block is the live region that announces the score, and landing
   * on it puts the next Tab at the primary action instead of the top of the page.
   */
  useEffect(() => {
    resultRef.current?.focus();
  }, []);

  const control =
    'inline-flex h-11 w-full items-center justify-center rounded-control px-5 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card focus-visible:outline-none';

  return (
    <>
      <div
        ref={resultRef}
        tabIndex={-1}
        aria-live="polite"
        className="rounded-control focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card focus-visible:outline-none"
      >
        <QuizScoreSummary
          attempt={result.attempt}
          locale={locale}
          labels={scoreLabels}
          variant="bare"
        />
      </div>
      <ul className="mt-6 divide-y divide-border">
        {result.questions.map((question) => (
          <li
            key={question.subject}
            className="grid h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-3"
          >
            <span
              className={`min-w-0 truncate text-sm ${
                question.status === 'skipped' ? 'text-muted-foreground' : ''
              }`}
            >
              {question.text}
            </span>
            {STATUS_MARK[question.status]}
            <span className="sr-only">{statusLabels[question.status]}</span>
          </li>
        ))}
      </ul>
      <div className="mt-auto flex flex-col gap-3 pt-6">
        <Link
          href="/register"
          className={`${control} bg-primary text-primary-foreground hover:bg-cobalt-hover`}
        >
          {labels.cta}
        </Link>
        <button
          type="button"
          onClick={onRestart}
          className={`${control} border border-input text-primary hover:bg-secondary`}
        >
          {labels.restart}
        </button>
      </div>
    </>
  );
}
