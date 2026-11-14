import {
  DEMO_QUESTION_ORDER,
  QUIZ_QUESTION_FIXTURES,
  type QuizFixtureLocale,
  type QuizSubject,
} from '@/components/marketing/previews/quiz-question-fixtures';
import type { QuizScoreSummaryAttempt } from '@/components/quiz/quiz-score-summary';

/** How one demo question ended: answered right, answered wrong, or left alone. */
export type QuizDemoStatus = 'correct' | 'wrong' | 'skipped';

export interface QuizDemoQuestion {
  subject: QuizSubject;
  /** The fixture's stem in the page's locale; full text, truncated only by CSS. */
  text: string;
  status: QuizDemoStatus;
}

export interface QuizDemoResult {
  /** The shape the review header reads, so the extracted summary can render it. */
  attempt: QuizScoreSummaryAttempt;
  questions: readonly QuizDemoQuestion[];
}

export interface BuildQuizDemoResultInput {
  locale: QuizFixtureLocale;
  /** Raw preview selections, keyed `<subject>:option`. */
  answers: Readonly<Record<string, string>>;
  startedAt: string;
}

/**
 * The visitor's finished attempt, graded from the answers they gave.
 *
 * The demo has an answer key (`correctOptionId` on each fixture), so this is not
 * an invented result: each of the four questions is graded against the key, and
 * the score the card shows is the score those answers earned. The attempt is the
 * review header's own shape (`QuizScoreSummaryAttempt`), so the extracted
 * component renders it without a preview-only format.
 *
 * A question the visitor never answered is `skipped`, not `wrong`: they may have
 * stepped past it, and three red crosses for three untouched questions would
 * accuse them of something they did not do.
 */
export function buildQuizDemoResult({
  locale,
  answers,
  startedAt,
}: BuildQuizDemoResultInput): QuizDemoResult {
  const graded = DEMO_QUESTION_ORDER.map((subject) => {
    const fixture = QUIZ_QUESTION_FIXTURES[locale][subject];
    const selectedAnswerId = answers[`${subject}:option`] ?? null;
    const status: QuizDemoStatus =
      selectedAnswerId === null
        ? 'skipped'
        : selectedAnswerId === fixture.correctOptionId
          ? 'correct'
          : 'wrong';

    return { subject, text: fixture.stem, type: fixture.type, status };
  });

  return {
    attempt: {
      score: graded.filter(({ status }) => status === 'correct').length,
      totalQuestions: graded.length,
      totalPoints: null,
      isAssignment: false,
      startedAt,
      questions: graded.map(({ type }) => ({ type })),
    },
    questions: graded.map(({ subject, text, status }) => ({ subject, text, status })),
  };
}
