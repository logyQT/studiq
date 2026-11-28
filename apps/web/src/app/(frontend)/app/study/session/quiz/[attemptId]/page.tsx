'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { QuizQuestionView } from '@/components/quiz/quiz-question-view';
import { EntityNotFound } from '@/components/shared/entity-not-found';
import { useQuizDraftAutosave } from '@/hooks/use-quiz-draft-autosave';
import { apiGet, apiPost } from '@/lib/api';
import { quizAttemptKeys } from '@/lib/query-keys';
import {
  type DraftQuestion,
  type QuizDraftAnswer,
  seedQuizAnswers,
  toSaveAnswersPayload,
} from '@/lib/quiz-draft';

interface Question extends DraftQuestion {
  content: string;
  question_answers: Array<{ id: string; content: string }>;
}

interface AttemptDetails {
  id: string;
  score: number;
  total_questions: number;
  completed_at: string | null;
  questions: Question[];
  answers: Record<string, QuizDraftAnswer>;
}

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

export default function QuizTakingPage() {
  const t = useTranslations('AppQuizTakingPage');
  const params = useParams<{ attemptId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const attemptId = params.attemptId;

  const [attempt, setAttempt] = useState<AttemptDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string | undefined>>({});
  const [submitting, setSubmitting] = useState(false);

  const draft = useQuizDraftAutosave({
    attemptId,
    questions: attempt?.questions,
    answers,
    failureMessage: t('save_failed'),
  });

  useEffect(() => {
    apiGet<AttemptDetails>(`/api/v1/quiz/${attemptId}`)
      .then((data) => {
        if (data.completed_at) {
          router.push(`/app/study/session/quiz/${attemptId}/review`);
          return undefined;
        }
        const seeded = seedQuizAnswers(data.questions, data.answers);
        setAnswers(seeded);
        // The server has this state already: only a change from it is saved.
        draft.markSaved(data.questions, seeded);
        setAttempt(data);
        setLoading(false);
        return undefined;
      })
      .catch(() => {
        toast.error(t('load_failed'));
        setLoading(false);
      });
  }, [attemptId, router, t, draft]);

  async function submitQuiz() {
    if (!attempt || submitting) return;
    // A double click must not send the sheet twice: the server now completes an
    // attempt once (#1066), but the second request would still be refused and
    // its toast would race the review redirect.
    setSubmitting(true);

    // A queued autosave must not land (and 400/toast) after the redirect.
    draft.stop();

    // `open` questions carry free text; only mcq/true_false carry an option id.
    const quizAnswers = toSaveAnswersPayload(attempt.questions, answers);

    try {
      await apiPost(`/api/v1/quiz/${attemptId}`, { answers: quizAnswers });
      await queryClient.invalidateQueries({ queryKey: quizAttemptKeys.all });
      router.push(`/app/study/session/quiz/${attemptId}/review`);
    } catch {
      // Stay on the page so the student can retry, e.g. after a network failure.
      setSubmitting(false);
      draft.resume();
      toast.error(t('submit_failed'));
    }
  }

  if (loading) return <div className="flex justify-center py-12">{t('loading')}</div>;
  if (!attempt)
    return <EntityNotFound titleKey="quiz_not_found" descriptionKey="quiz_not_found_desc" />;

  const questions = attempt.questions;
  const currentQuestion = questions[currentQ];
  if (!currentQuestion) {
    return <EntityNotFound titleKey="quiz_not_found" descriptionKey="quiz_not_found_desc" />;
  }

  function selectAnswer(questionId: string, value: string) {
    setAnswers((previous) => ({ ...previous, [questionId]: value }));
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <QuizQuestionView
        question={{
          stem: currentQuestion.content,
          options: currentQuestion.question_answers.map((answer) => ({
            id: answer.id,
            label: answer.content,
          })),
          selectedOptionId:
            currentQuestion.type === 'open' ? null : (answers[currentQuestion.id] ?? null),
          textAnswer: currentQuestion.type === 'open' ? (answers[currentQuestion.id] ?? '') : '',
          position: currentQ + 1,
          total: questions.length,
          type: currentQuestion.type,
        }}
        labels={{
          questionOf: t('question_of', { current: currentQ + 1, total: questions.length }),
          typeLabel: isQuestionTypeKey(currentQuestion.type)
            ? t(QUESTION_TYPE_KEYS[currentQuestion.type])
            : currentQuestion.type.replace('_', ' '),
          previous: t('previous'),
          next: t('next'),
          submit: t('submit'),
          submitting: t('submitting'),
          answerPlaceholder: t('answer_placeholder'),
        }}
        submitting={submitting}
        onSelectOption={(optionId) => selectAnswer(currentQuestion.id, optionId)}
        onTextChange={(text) => selectAnswer(currentQuestion.id, text)}
        onPrevious={() => setCurrentQ((index) => Math.max(0, index - 1))}
        onNext={() => setCurrentQ((index) => Math.min(questions.length - 1, index + 1))}
        onSubmit={() => void submitQuiz()}
      />
    </div>
  );
}
