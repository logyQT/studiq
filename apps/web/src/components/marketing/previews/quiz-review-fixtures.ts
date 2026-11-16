import type {
  QuizReviewGivenAnswer,
  QuizReviewQuestion,
} from '@/components/quiz/quiz-question-review';
import type { QuizScoreSummaryAttempt } from '@/components/quiz/quiz-score-summary';
import {
  DEMO_QUESTION_ORDER,
  QUIZ_QUESTION_FIXTURES,
  type QuizFixtureLocale,
  type QuizSubject,
} from '@/components/marketing/previews/quiz-question-fixtures';

/**
 * Preview data only — never a seed, never a fetch.
 *
 * A finished attempt over the same four questions the landing's demo asks, so
 * the two pages show one story: you answered them there, this is what is kept
 * here. The score is derived from the fixtures' own answer key rather than
 * typed in, so it cannot claim a result the attempt did not earn.
 *
 * One question was answered wrong on purpose: the review's job is to show the
 * answer key and the explanation beside the answer that missed, which is the
 * half of the loop a screenshot of a score cannot show.
 */
export type QuizReviewFixtureLocale = QuizFixtureLocale;

/** What the visitor answered, per question of the demo sequence. */
const SELECTED: Partial<Record<QuizSubject, string>> = {
  biology: 'mitochondrium',
  history: 'true',
  driving: 'yield',
  // The one wrong answer: JOIN narrows nothing, it joins.
  tech: 'join',
};

const EXPLANATIONS: Record<QuizFixtureLocale, Partial<Record<QuizSubject, string>>> = {
  pl: {
    tech: 'WHERE filtruje wiersze, zanim trafią do grupowania. JOIN tylko łączy tabele i nie zawęża wyniku.',
  },
  en: {
    tech: 'WHERE filters rows before they are grouped. JOIN only combines tables and narrows nothing.',
  },
};

export interface QuizReviewFixtureQuestion {
  /** 1-based position in the attempt, as the review header numbers it. */
  number: number;
  question: QuizReviewQuestion;
  answer: QuizReviewGivenAnswer;
}

export interface QuizReviewFixture {
  attempt: QuizScoreSummaryAttempt;
  questions: readonly QuizReviewFixtureQuestion[];
}

function buildFixture(locale: QuizReviewFixtureLocale): QuizReviewFixture {
  const questions = DEMO_QUESTION_ORDER.map((subject, index) => {
    const fixture = QUIZ_QUESTION_FIXTURES[locale][subject];
    const selected = SELECTED[subject] ?? null;

    return {
      number: index + 1,
      question: {
        id: `demo-${subject}`,
        content: fixture.stem,
        type: fixture.type,
        explanation: EXPLANATIONS[locale][subject] ?? null,
        question_answers: fixture.options.map((option) => ({
          id: option.id,
          content: option.label,
          is_correct: option.id === fixture.correctOptionId,
        })),
      },
      answer: {
        selected_answer_id: selected,
        text_answer: null,
        is_correct: selected === fixture.correctOptionId,
      },
    };
  });

  return {
    attempt: {
      score: questions.filter(({ answer }) => answer.is_correct).length,
      totalQuestions: questions.length,
      totalPoints: null,
      isAssignment: false,
      startedAt: '2026-11-12T18:40:00.000Z',
      questions: questions.map(({ question }) => ({ type: question.type })),
    },
    questions,
  };
}

export const QUIZ_REVIEW_FIXTURES: Record<QuizReviewFixtureLocale, QuizReviewFixture> = {
  pl: buildFixture('pl'),
  en: buildFixture('en'),
};
