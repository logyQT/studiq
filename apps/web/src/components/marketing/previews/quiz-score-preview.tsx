'use client';

import { useLocale, useTranslations } from 'next-intl';
import {
  QUIZ_REVIEW_FIXTURES,
  type QuizReviewFixtureLocale,
} from '@/components/marketing/previews/quiz-review-fixtures';
import { scoreSummaryLabels } from '@/components/quiz/quiz-review-labels';
import { QuizScoreSummary } from '@/components/quiz/quiz-score-summary';

/**
 * The head of a finished attempt: the review route's own score card, from a
 * fixture attempt whose score is derived from the fixtures' answer key.
 *
 * It stands apart from the question card because the page puts it in the margin:
 * a result read at a glance, next to the question that produced it.
 */
export function QuizScorePreview() {
  const locale: QuizReviewFixtureLocale = useLocale() === 'en' ? 'en' : 'pl';
  const t = useTranslations('AppQuizReviewPage');
  const { attempt } = QUIZ_REVIEW_FIXTURES[locale];

  return (
    <QuizScoreSummary
      attempt={attempt}
      locale={locale}
      labels={scoreSummaryLabels(t)}
      variant="card"
    />
  );
}
