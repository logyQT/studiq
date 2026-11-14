'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@studiq/ui';
import { CheckCircle, XCircle } from 'lucide-react';

export interface QuizReviewAnswer {
  id: string;
  content: string;
  is_correct: boolean;
}

export interface QuizReviewQuestion {
  id: string;
  content: string;
  type: string;
  explanation?: string | null;
  question_answers: readonly QuizReviewAnswer[];
}

/** What the student submitted for one question; absent when they skipped it. */
export interface QuizReviewGivenAnswer {
  selected_answer_id: string | null;
  text_answer: string | null;
  is_correct: boolean;
}

export interface QuizQuestionReviewLabels {
  /** Already interpolated, e.g. „P3”. */
  questionShort: string;
  typeLabel: string;
  badgeCorrect: string;
  badgeIncorrect: string;
  badgePendingReview: string;
  badgeSelfCheck: string;
  yourAnswer: string;
  noAnswer: string;
  explanation: string;
}

export interface QuizQuestionReviewProps {
  question: QuizReviewQuestion;
  answer: QuizReviewGivenAnswer | undefined;
  /** `true` for assignment attempts, whose open answers a teacher grades. */
  isAssignment: boolean;
  labels: QuizQuestionReviewLabels;
}

/**
 * One question of a finished attempt, with the answer key exposed.
 *
 * Extracted from the review page so the marketing preview can render the same
 * card — the page supplies its translator, the preview its fixture copy.
 */
export function QuizQuestionReview({
  question,
  answer,
  isAssignment,
  labels,
}: QuizQuestionReviewProps) {
  const isCorrect = answer?.is_correct ?? false;
  const isOpenQuestion = question.type === 'open';

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{labels.questionShort}</Badge>
          <Badge variant="outline">{labels.typeLabel}</Badge>
          {isOpenQuestion ? (
            // A practice attempt has no reviewer, so „pending review” would be a
            // promise nobody keeps (#329).
            <Badge variant="outline" className="ml-auto">
              {isAssignment ? labels.badgePendingReview : labels.badgeSelfCheck}
            </Badge>
          ) : (
            <Badge variant={isCorrect ? 'default' : 'destructive'} className="ml-auto">
              {isCorrect ? labels.badgeCorrect : labels.badgeIncorrect}
            </Badge>
          )}
        </div>
        <CardTitle className="mt-2 text-lg">{question.content}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {question.type === 'mcq' && (
          <div className="flex flex-col gap-2">
            {question.question_answers.map((option) => {
              const isCorrectAnswer = option.is_correct;
              const isSelected = option.id === answer?.selected_answer_id;
              return (
                <div
                  key={option.id}
                  data-correct={isCorrectAnswer}
                  data-selected={isSelected && !isCorrectAnswer}
                  className="rounded-lg border p-3 data-[correct=true]:border-green-200 data-[correct=true]:bg-green-50 data-[selected=true]:border-red-200 data-[selected=true]:bg-red-50 dark:data-[correct=true]:border-green-900 dark:data-[correct=true]:bg-green-950/40 dark:data-[selected=true]:border-red-900 dark:data-[selected=true]:bg-red-950/40"
                >
                  <div className="flex items-center gap-2">
                    {isCorrectAnswer && (
                      <CheckCircle
                        className="size-4 shrink-0 text-green-600 dark:text-green-400"
                        aria-label={labels.badgeCorrect}
                      />
                    )}
                    {isSelected && !isCorrectAnswer && (
                      <XCircle
                        className="size-4 shrink-0 text-red-600 dark:text-red-400"
                        aria-label={labels.badgeIncorrect}
                      />
                    )}
                    <span
                      className={
                        isSelected && !isCorrectAnswer ? 'text-muted-foreground line-through' : ''
                      }
                    >
                      {option.content}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {question.type === 'true_false' && (
          <div className="grid grid-cols-2 gap-3">
            {question.question_answers.map((option) => {
              const isCorrectAnswer = option.is_correct;
              const isSelected = option.id === answer?.selected_answer_id;
              return (
                <Button
                  key={option.id}
                  variant={isCorrectAnswer ? 'default' : isSelected ? 'destructive' : 'outline'}
                  className="h-16 gap-2 text-lg"
                  disabled
                >
                  {isCorrectAnswer && (
                    <CheckCircle className="size-4 shrink-0" aria-label={labels.badgeCorrect} />
                  )}
                  {isSelected && !isCorrectAnswer && (
                    <XCircle className="size-4 shrink-0" aria-label={labels.badgeIncorrect} />
                  )}
                  {option.content}
                </Button>
              );
            })}
          </div>
        )}
        {question.type === 'open' && (
          <div className="rounded-lg border bg-muted p-3">
            <span className="text-sm text-muted-foreground">{labels.yourAnswer}: </span>
            <span className="font-medium whitespace-pre-wrap">
              {answer?.text_answer || labels.noAnswer}
            </span>
          </div>
        )}
        {question.explanation && (
          <div className="rounded-lg border bg-blue-50 p-3 text-sm dark:bg-blue-950/30">
            <span className="font-medium">{labels.explanation}: </span>
            {question.explanation}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
