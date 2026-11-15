'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@studiq/ui';
import { formatDate } from '@/lib/datetime';

/** The attempt facts the score card reads; the review page's attempt is a superset. */
export interface QuizScoreSummaryAttempt {
  score: number;
  totalQuestions: number;
  totalPoints: number | null;
  /** Assignment attempts are scored in points; practice quizzes count correct answers. */
  isAssignment: boolean;
  startedAt: string;
  questions: readonly { type: string }[];
}

/**
 * Labels arrive interpolated rather than as message keys, so the card can stay
 * locale-agnostic: the review page passes its translator, the marketing preview
 * passes the same one.
 */
export interface QuizScoreSummaryLabels {
  scorePercent: (percentage: number) => string;
  pointsOutOf: (score: number, total: number) => string;
  correctOf: (score: number, total: number) => string;
  correctClosed: (score: number, total: number) => string;
  openQuestionsLine: (count: number) => string;
  openOnlyTitle: string;
  openOnlyDesc: (count: number) => string;
}

export interface QuizScoreSummaryProps {
  attempt: QuizScoreSummaryAttempt;
  locale: string;
  labels: QuizScoreSummaryLabels;
  /**
   * `card` is the review page: its own card, a centred headline and the
   * attempt's date. `bare` is the marketing demo, which renders the same states
   * inside the question card's body on one left axis and drops the date — the
   * visitor is looking at the attempt they have just finished, not at a dated
   * record. The state derivation is shared, so the two cannot disagree.
   */
  variant?: 'card' | 'bare';
}

/**
 * The headline of a finished attempt.
 *
 * It has four mutually exclusive states, not variants: what an honest score even
 * is depends on the questions the attempt asked. Assignment attempts are scored
 * in points; open answers have no answer key, so a practice quiz only has a
 * denominator for its closed questions, and a quiz with no closed question has no
 * percentage at all (#329). The state is derived here rather than by the caller
 * because the marketing preview renders this summary too — a second place
 * deciding which headline is true is exactly how a preview stops matching the
 * product.
 */
export function QuizScoreSummary({
  attempt,
  locale,
  labels,
  variant = 'card',
}: QuizScoreSummaryProps) {
  const openCount = attempt.questions.filter((question) => question.type === 'open').length;
  const gradableCount = attempt.questions.length - openCount;
  const assignmentTotal = attempt.totalPoints || attempt.totalQuestions;
  const assignmentPercentage =
    assignmentTotal > 0 ? Math.round((attempt.score / assignmentTotal) * 100) : 0;
  const gradablePercentage =
    gradableCount > 0 ? Math.round((attempt.score / gradableCount) * 100) : 0;

  const summary = attempt.isAssignment
    ? {
        title: labels.scorePercent(assignmentPercentage),
        description: labels.pointsOutOf(attempt.score, assignmentTotal),
      }
    : gradableCount === 0
      ? // Nothing was auto-graded, so there is no percentage to show at all.
        {
          title: labels.openOnlyTitle,
          description: labels.openOnlyDesc(openCount),
        }
      : openCount > 0
        ? // Mixed quiz: the closed denominator is the only honest one, so the
          // mandated „X z Y pytań zamkniętych” headline replaces the percentage.
          {
            title: labels.correctClosed(attempt.score, gradableCount),
            description: labels.openQuestionsLine(openCount),
          }
        : {
            title: labels.scorePercent(gradablePercentage),
            description: labels.correctOf(attempt.score, gradableCount),
          };

  if (variant === 'bare') {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-3xl leading-none font-semibold">{summary.title}</p>
        <p className="text-sm text-muted-foreground">{summary.description}</p>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-3xl">{summary.title}</CardTitle>
        <CardDescription>{summary.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-center gap-4 text-sm text-muted-foreground">
          <span>{formatDate(attempt.startedAt, locale)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
