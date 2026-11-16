'use client';

import { useLocale, useTranslations } from 'next-intl';
import {
  QUIZ_REVIEW_FIXTURES,
  type QuizReviewFixtureLocale,
} from '@/components/marketing/previews/quiz-review-fixtures';
import { QuizQuestionReview } from '@/components/quiz/quiz-question-review';
import { questionReviewLabels } from '@/components/quiz/quiz-review-labels';

/**
 * One question of a finished attempt, exactly as the review route renders it:
 * the answer key opened up, the answer that missed struck through, and the
 * explanation underneath.
 *
 * The missed question is the specimen because that is the half of the loop a
 * score cannot show: the product says what was right and why, not only how many.
 * Nothing here is wrapped, cropped or restyled — the card is the card.
 */
export function QuizReviewPreview() {
  const locale: QuizReviewFixtureLocale = useLocale() === 'en' ? 'en' : 'pl';
  const t = useTranslations('AppQuizReviewPage');
  const { questions } = QUIZ_REVIEW_FIXTURES[locale];

  const shown = questions.find(({ answer }) => !answer.is_correct);
  if (!shown) return null;

  return (
    <QuizQuestionReview
      question={shown.question}
      answer={shown.answer}
      isAssignment={false}
      labels={questionReviewLabels(t, { number: shown.number, type: shown.question.type })}
    />
  );
}
