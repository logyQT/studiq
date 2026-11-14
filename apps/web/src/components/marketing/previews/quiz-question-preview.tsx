import { createTranslator } from 'next-intl';
import { QuizQuestionView } from '@/components/quiz/quiz-question-view';
import { QUIZ_QUESTION_FIXTURES } from '@/components/marketing/previews/quiz-question-fixtures';
import pl from '@/i18n/messages/pl.json';

/**
 * The quiz card as the marketing page shows it: the same component the student
 * gets, rendered from a fixture and never from a fetch. The card is a client
 * component, so its markup is server-rendered into the initial document and
 * hydration only attaches behaviour to markup that is already there
 * (DESIGN.md §Product imagery).
 *
 * Content and chrome are both Polish on purpose — the fixture set is Polish, and
 * an English „Question 2 of 5” wrapped around it is the mixed-locale mistake the
 * same section bans.
 */
const t = createTranslator({ locale: 'pl', messages: pl, namespace: 'AppQuizTakingPage' });

export function QuizQuestionPreview() {
  const question = QUIZ_QUESTION_FIXTURES.biology;

  return (
    <QuizQuestionView
      question={question}
      labels={{
        questionOf: t('question_of', { current: question.position, total: question.total }),
        typeLabel: t('type_mcq'),
        previous: t('previous'),
        next: t('next'),
        submit: t('submit'),
        submitting: t('submitting'),
        answerPlaceholder: t('answer_placeholder'),
      }}
    />
  );
}
