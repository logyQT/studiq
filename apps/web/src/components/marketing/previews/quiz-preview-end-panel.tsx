import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

export interface QuizPreviewEndPanelLabels {
  title: string;
  body: string;
  cta: string;
  dismiss: string;
}

export interface QuizPreviewEndPanelProps {
  labels: QuizPreviewEndPanelLabels;
  onDismiss: () => void;
}

/**
 * What the demo says once its last question is finished.
 *
 * It replaces the answer region rather than sitting above or below the footer:
 * the options are spent the moment Finish is pressed, and swapping them out is
 * the only placement that costs the card no height — so the button the visitor
 * just pressed does not move. It is not a dialog and does not trap focus; see
 * `QuizQuestionView`, which owns the disclosure and its focus moves.
 *
 * The action is a link, not a second `signal` fill: the hero's own CTA is the
 * screen's one primary (DESIGN.md §Dosage).
 */
export function QuizPreviewEndPanel({ labels, onDismiss }: QuizPreviewEndPanelProps) {
  return (
    <div>
      <p className="text-base font-semibold text-foreground">{labels.title}</p>
      <p className="mt-2 text-sm text-muted-foreground">{labels.body}</p>
      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1">
        <Link
          href="/register"
          className="inline-flex h-11 items-center gap-2 rounded-control text-sm font-semibold text-primary underline underline-offset-4 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card focus-visible:outline-none"
        >
          {labels.cta}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex h-11 items-center rounded-control text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card focus-visible:outline-none"
        >
          {labels.dismiss}
        </button>
      </div>
    </div>
  );
}
