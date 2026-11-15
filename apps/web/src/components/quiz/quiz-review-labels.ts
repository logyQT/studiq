import type { useTranslations } from 'next-intl';
import type {
  QuizQuestionReviewLabels,
  QuizReviewQuestion,
} from '@/components/quiz/quiz-question-review';
import type { QuizScoreSummaryLabels } from '@/components/quiz/quiz-score-summary';

/**
 * The review screen's copy, wired to a translator exactly once.
 *
 * The page and the marketing preview both render the same two components and
 * both need the same label map — two hand-kept copies is how a preview starts
 * quoting wording the product no longer uses. The parameter is the translator
 * the namespace's hook returns, so both callers pass `useTranslations` and a
 * mistyped key is a compile error in one place instead of a stale string in two.
 */
type ReviewTranslator = ReturnType<typeof useTranslations<'AppQuizReviewPage'>>;

/** Question types the generator produces; anything else falls back to its raw value. */
const QUESTION_TYPE_KEYS = {
  mcq: 'type_mcq',
  true_false: 'type_true_false',
  open: 'type_open',
} as const;

type QuestionTypeKey = keyof typeof QUESTION_TYPE_KEYS;

function isQuestionTypeKey(value: string): value is QuestionTypeKey {
  return Object.hasOwn(QUESTION_TYPE_KEYS, value);
}

export function scoreSummaryLabels(t: ReviewTranslator): QuizScoreSummaryLabels {
  return {
    scorePercent: (percentage) => t('score_percent', { percentage }),
    pointsOutOf: (score, total) => t('points_out_of', { score, total }),
    correctOf: (score, total) => t('correct_of', { score, total }),
    correctClosed: (score, total) => t('correct_closed', { score, total }),
    openQuestionsLine: (count) => t('open_questions_line', { count }),
    openOnlyTitle: t('open_only_title'),
    openOnlyDesc: (count) => t('open_only_desc', { count }),
  };
}

export function questionReviewLabels(
  t: ReviewTranslator,
  { number, type }: { number: number; type: QuizReviewQuestion['type'] },
): QuizQuestionReviewLabels {
  return {
    questionShort: t('question_short', { number }),
    typeLabel: isQuestionTypeKey(type) ? t(QUESTION_TYPE_KEYS[type]) : type.replace('_', ' '),
    badgeCorrect: t('badge_correct'),
    badgeIncorrect: t('badge_incorrect'),
    badgePendingReview: t('badge_pending_review'),
    badgeSelfCheck: t('badge_self_check'),
    yourAnswer: t('your_answer'),
    noAnswer: t('no_answer'),
    explanation: t('explanation'),
  };
}
