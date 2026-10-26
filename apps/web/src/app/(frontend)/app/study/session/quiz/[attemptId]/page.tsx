'use client';

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  Label,
  Progress,
  RadioGroup,
  RadioGroupItem,
  Textarea,
} from '@studiq/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Send } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { EntityNotFound } from '@/components/shared/entity-not-found';
import { apiGet, apiPost, apiPut } from '@/lib/api';
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

const AUTOSAVE_DELAY_MS = 500;

/** Question types the generator produces; anything else falls back to its raw value. */
const QUESTION_TYPE_KEYS = {
  mcq: 'type_mcq',
  true_false: 'type_true_false',
  open: 'type_open',
} as const;

export default function QuizTakingPage() {
  const t = useTranslations('AppQuizTakingPage');
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const attemptId = params.attemptId as string;

  const [attempt, setAttempt] = useState<AttemptDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string | undefined>>({});

  // Last payload body the server acknowledged (or that we seeded from).
  const lastSavedRef = useRef<string>('');
  // Payload body that has not been persisted yet — flushed when the page unmounts.
  const pendingRef = useRef<string | null>(null);
  // One toast per failure streak, so a dead endpoint cannot spam.
  const saveFailedRef = useRef(false);

  useEffect(() => {
    apiGet<AttemptDetails>(`/api/v1/quiz/${attemptId}`)
      .then((data) => {
        if (data.completed_at) {
          router.push(`/app/study/session/quiz/${attemptId}/review`);
          return;
        }
        const seeded = seedQuizAnswers(data.questions, data.answers);
        setAnswers(seeded);
        // Pretend we already saved the seeded state: without this the autosave
        // would immediately write the draft back after every load.
        lastSavedRef.current = JSON.stringify({
          answers: toSaveAnswersPayload(data.questions, seeded),
        });
        setAttempt(data);
        setLoading(false);
      })
      .catch(() => {
        toast.error(t('load_failed'));
        setLoading(false);
      });
  }, [attemptId, router, t]);

  // Autosave the full answer set while the attempt is running (#349).
  useEffect(() => {
    if (!attempt) return;

    const payload = toSaveAnswersPayload(attempt.questions, answers);
    const body = JSON.stringify({ answers: payload });
    if (body === lastSavedRef.current) return;

    pendingRef.current = body;
    const timer = setTimeout(async () => {
      try {
        await apiPut(`/api/v1/quiz/${attemptId}/answers`, { answers: payload });
        lastSavedRef.current = body;
        if (pendingRef.current === body) pendingRef.current = null;
        saveFailedRef.current = false;
      } catch {
        // Keep the payload pending so the unmount flush can retry it, and tell
        // the student instead of silently restoring the old bug.
        if (!saveFailedRef.current) {
          saveFailedRef.current = true;
          toast.error(t('save_failed'));
        }
      }
    }, AUTOSAVE_DELAY_MS);

    return () => clearTimeout(timer);
  }, [answers, attempt, attemptId, t]);

  // Leaving through the sidebar unmounts the page instantly; flush what the
  // debounce has not sent yet.
  useEffect(() => {
    return () => {
      const body = pendingRef.current;
      if (!body) return;
      fetch(`/api/v1/quiz/${attemptId}/answers`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {});
    };
  }, [attemptId]);

  async function submitQuiz() {
    if (!attempt) return;

    // A queued autosave must not land (and 400/toast) after the redirect.
    pendingRef.current = null;

    // `open` questions carry free text; only mcq/true_false carry an option id.
    const quizAnswers = toSaveAnswersPayload(attempt.questions, answers);

    try {
      await apiPost(`/api/v1/quiz/${attemptId}`, { answers: quizAnswers });
      await queryClient.invalidateQueries({ queryKey: quizAttemptKeys.all });
      router.push(`/app/study/session/quiz/${attemptId}/review`);
    } catch {
      toast.error(t('submit_failed'));
    }
  }

  if (loading) return <div className="flex justify-center py-12">{t('loading')}</div>;
  if (!attempt)
    return <EntityNotFound titleKey="quiz_not_found" descriptionKey="quiz_not_found_desc" />;

  const questions = attempt.questions;
  const currentQuestion = questions[currentQ];
  const progress = questions.length > 0 ? ((currentQ + 1) / questions.length) * 100 : 0;

  function selectAnswer(questionId: string, answerId: string) {
    setAnswers({ ...answers, [questionId]: answerId });
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex justify-end">
        <span className="text-sm text-muted-foreground">
          {t('question_of', { current: currentQ + 1, total: questions.length })}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <Progress value={progress} />
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline">
              {QUESTION_TYPE_KEYS[currentQuestion.type as keyof typeof QUESTION_TYPE_KEYS]
                ? t(QUESTION_TYPE_KEYS[currentQuestion.type as keyof typeof QUESTION_TYPE_KEYS])
                : currentQuestion.type.replace('_', ' ')}
            </Badge>
          </div>
          <CardTitle className="mt-3 text-xl">{currentQuestion.content}</CardTitle>
        </CardHeader>
        <CardContent>
          {currentQuestion.type === 'mcq' && (
            <RadioGroup
              value={answers[currentQuestion.id] || ''}
              onValueChange={(v) => selectAnswer(currentQuestion.id, v)}
            >
              {currentQuestion.question_answers.map((a) => (
                <div
                  key={a.id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 hover:bg-accent/50"
                >
                  <RadioGroupItem value={a.id} id={a.id} />
                  <Label htmlFor={a.id} className="flex-1 cursor-pointer">
                    {a.content}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          )}
          {currentQuestion.type === 'true_false' && (
            <div className="grid grid-cols-2 gap-3">
              {currentQuestion.question_answers.map((a) => (
                <Button
                  key={a.id}
                  variant={answers[currentQuestion.id] === a.id ? 'default' : 'outline'}
                  className="h-20 text-lg"
                  onClick={() => selectAnswer(currentQuestion.id, a.id)}
                >
                  {a.content}
                </Button>
              ))}
            </div>
          )}
          {currentQuestion.type === 'open' && (
            <Textarea
              value={answers[currentQuestion.id] || ''}
              onChange={(e) => selectAnswer(currentQuestion.id, e.target.value)}
              placeholder={t('answer_placeholder')}
              rows={4}
            />
          )}
        </CardContent>
        <CardFooter className="flex justify-between">
          <Button
            variant="outline"
            disabled={currentQ === 0}
            onClick={() => setCurrentQ(currentQ - 1)}
          >
            <ArrowLeft data-icon="inline-start" /> {t('previous')}
          </Button>
          {currentQ < questions.length - 1 ? (
            <Button onClick={() => setCurrentQ(currentQ + 1)}>
              {t('next')} <ArrowRight data-icon="inline-end" />
            </Button>
          ) : (
            <Button onClick={submitQuiz}>
              {t('submit')} <Send data-icon="inline-end" />
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
