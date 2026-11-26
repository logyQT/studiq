'use client';

import { useLocale } from 'next-intl';
import { ProblemQuestionsCard } from '@/components/edu/dashboard/problem-questions-card';
import {
  PROBLEM_QUESTION_FIXTURES,
  type ProblemQuestionsLocale,
} from '@/components/marketing/previews/problem-questions-fixtures';

/**
 * The teacher dashboard's problem-question card as a page shows it.
 *
 * The card is already presentational — it takes its rows as a prop and reads the
 * course's own copy — so this file is only the fixture and the two flags it asks
 * for. `onRetry` is required by the card's error state, which cannot occur here:
 * nothing is fetched, so there is nothing to retry.
 */
export function ProblemQuestionsPreview() {
  const locale: ProblemQuestionsLocale = useLocale() === 'en' ? 'en' : 'pl';

  return (
    <ProblemQuestionsCard
      questions={PROBLEM_QUESTION_FIXTURES[locale]}
      isLoading={false}
      isError={false}
      onRetry={() => {}}
      headingLevel={3}
      linked={false}
    />
  );
}
