'use client';

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  Progress,
  RadioGroup,
  RadioGroupItem,
  Textarea,
} from '@studiq/ui';
import { ArrowLeft, ArrowRight, Send } from 'lucide-react';

/** One selectable answer; `id` is the value the attempt persists as the answer. */
export interface QuizQuestionOption {
  id: string;
  label: string;
}

export interface QuizQuestionViewQuestion {
  stem: string;
  options: readonly QuizQuestionOption[];
  /** The chosen option, or `null` before the student answers. `mcq` only. */
  selectedOptionId: string | null;
  /** Free text of an `open` question; `''` for the other types. */
  textAnswer: string;
  /** 1-based position of this question in the attempt. */
  position: number;
  total: number;
  /** `mcq`, `true_false` or `open`; any other value renders no answer controls. */
  type: string;
}

export interface QuizQuestionViewLabels {
  /** Already interpolated, e.g. „Pytanie 2 z 5”. */
  questionOf: string;
  typeLabel: string;
  previous: string;
  next: string;
  submit: string;
  submitting: string;
  answerPlaceholder: string;
}

export interface QuizQuestionViewProps {
  question: QuizQuestionViewQuestion;
  labels: QuizQuestionViewLabels;
  /** The last question's action is a submit; it disables while the request is in flight. */
  submitting?: boolean;
  /**
   * Answering. Optional so the marketing preview can render the identical card
   * with fixture data and no behaviour; the taking page always passes them.
   */
  onSelectOption?: (optionId: string) => void;
  onTextChange?: (text: string) => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onSubmit?: () => void;
}

/**
 * The question card — one attempt question, from props only. The taking page
 * owns the attempt: loading, the answer state, autosave, submit and the review
 * redirect all stay there, so the same card can be rendered from a fixture on
 * the marketing page (DESIGN.md §Product imagery).
 */
export function QuizQuestionView({
  question,
  labels,
  submitting = false,
  onSelectOption,
  onTextChange,
  onPrevious,
  onNext,
  onSubmit,
}: QuizQuestionViewProps) {
  const progress = question.total > 0 ? (question.position / question.total) * 100 : 0;

  return (
    /*
     * Self-contained spacing: the view used to return a fragment and rely on the
     * caller's `flex flex-col gap-6`, so any caller without it — the marketing
     * preview — had the progress bar sitting on the card.
     *
     * `flex-1` takes the height the caller reserves, so the footer lands at the
     * bottom of that box instead of wherever this question's options end. `h-full`
     * cannot: a percentage height does not resolve against a parent that only sets
     * `min-height`, which is how the preview reserves its box.
     */
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex justify-end">
        <span className="text-sm text-muted-foreground">{labels.questionOf}</span>
      </div>

      <div className="flex flex-col gap-2">
        <Progress value={progress} />
      </div>

      <Card className="flex-1">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{labels.typeLabel}</Badge>
          </div>
          <CardTitle className="mt-3 text-xl">{question.stem}</CardTitle>
        </CardHeader>
        <CardContent className="flex-1">
          {question.type === 'mcq' && (
            <RadioGroup
              value={question.selectedOptionId ?? ''}
              onValueChange={(optionId) => onSelectOption?.(optionId)}
            >
              {question.options.map((option) => (
                /*
                 * The row is the label and contains the radio, rather than a
                 * `<label for>` beside it: the item renders a `button[role=radio]`,
                 * and a label referencing a button names it without activating it,
                 * which left the padding and the border dead. Containment uses the
                 * browser's own activation, so the click target and the accessible
                 * name are the row itself.
                 */
                <label
                  key={option.id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 select-none hover:bg-accent/50 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50"
                >
                  <RadioGroupItem value={option.id} id={option.id} />
                  <span className="flex-1 text-sm leading-none font-medium">{option.label}</span>
                </label>
              ))}
            </RadioGroup>
          )}
          {question.type === 'true_false' && (
            <div className="grid grid-cols-2 gap-3">
              {question.options.map((option) => (
                <Button
                  key={option.id}
                  variant={question.selectedOptionId === option.id ? 'default' : 'outline'}
                  className="h-20 text-lg"
                  onClick={() => onSelectOption?.(option.id)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          )}
          {question.type === 'open' && (
            <Textarea
              value={question.textAnswer}
              onChange={(event) => onTextChange?.(event.target.value)}
              placeholder={labels.answerPlaceholder}
              rows={4}
            />
          )}
        </CardContent>
        {/* The row wraps rather than clipping: the card is at its narrowest in the
            hero rail, and two labelled buttons do not always fit one line. Below
            360px the two of them cannot share a row in either locale, so they
            stack — a full-width pair always fits, and it keeps the footer one
            fixed height instead of wrapping on some questions and not others. */}
        <CardFooter className="flex flex-wrap justify-between gap-2 max-[359px]:flex-col max-[359px]:items-stretch">
          <Button variant="outline" disabled={question.position === 1} onClick={onPrevious}>
            <ArrowLeft data-icon="inline-start" /> {labels.previous}
          </Button>
          {question.position < question.total ? (
            <Button onClick={onNext}>
              {labels.next} <ArrowRight data-icon="inline-end" />
            </Button>
          ) : (
            <Button onClick={onSubmit} disabled={submitting}>
              {submitting ? labels.submitting : labels.submit} <Send data-icon="inline-end" />
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
