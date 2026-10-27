'use client';

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@studiq/ui';
import { CheckCircle, Eye, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { EntityNotFound } from '@/components/shared/entity-not-found';
import { apiGet } from '@/lib/api';
import { formatDate } from '@/lib/datetime';

interface Question {
  id: string;
  content: string;
  type: string;
  explanation?: string | null;
  question_answers: Array<{ id: string; content: string; is_correct: boolean }>;
}

interface AttemptDetails {
  id: string;
  score: number;
  total_questions: number;
  /** Max awardable points for assignment attempts; null for practice quizzes. */
  total_points: number | null;
  /** Non-null only for assignment attempts, whose open answers a teacher grades. */
  assignment_id: string | null;
  config: {
    questionTypes?: string[];
    questionCount?: number;
  } | null;
  started_at: string;
  completed_at: string | null;
  questions: Question[];
  answers: Record<
    string,
    { selected_answer_id: string | null; text_answer: string | null; is_correct: boolean }
  >;
}

/** Question types the generator produces; anything else falls back to its raw value. */
const QUESTION_TYPE_KEYS = {
  mcq: 'type_mcq',
  true_false: 'type_true_false',
  open: 'type_open',
} as const;

export default function QuizReviewPage() {
  const params = useParams();
  const attemptId = params.attemptId as string;
  const locale = useLocale();
  const t = useTranslations('AppQuizReviewPage');

  const [attempt, setAttempt] = useState<AttemptDetails | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<AttemptDetails>(`/api/v1/quiz/${attemptId}`)
      .then((data) => {
        setAttempt(data);
        setLoading(false);
      })
      .catch(() => {
        toast.error(t('load_failed'));
        setLoading(false);
      });
  }, [attemptId, t]);

  if (loading) return <div className="flex justify-center py-12">{t('loading')}</div>;
  if (!attempt)
    return <EntityNotFound titleKey="attempt_not_found" descriptionKey="attempt_not_found_desc" />;

  const isAssignment = attempt.assignment_id !== null;
  // Open answers have no answer key: they are never auto-graded, so a practice
  // score only has a denominator for the closed questions (#329).
  const openCount = attempt.questions.filter((q) => q.type === 'open').length;
  const gradableCount = attempt.questions.length - openCount;

  // Assignment attempts are scored in points (score = awarded points, max =
  // total_points); a practice quiz counts correct answers.
  const assignmentTotal = attempt.total_points || attempt.total_questions;
  const assignmentPercentage =
    assignmentTotal > 0 ? Math.round((attempt.score / assignmentTotal) * 100) : 0;
  const gradablePercentage =
    gradableCount > 0 ? Math.round((attempt.score / gradableCount) * 100) : 0;

  function typeLabel(type: string) {
    const key = QUESTION_TYPE_KEYS[type as keyof typeof QUESTION_TYPE_KEYS];
    return key ? t(key) : type.replace('_', ' ');
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">{t('title')}</h2>
        <Link href="/app/study">
          <Button variant="outline" size="sm">
            <Eye data-icon="inline-start" /> {t('back')}
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader className="text-center">
          {isAssignment ? (
            <>
              <CardTitle className="text-3xl">
                {t('score_percent', { percentage: assignmentPercentage })}
              </CardTitle>
              <CardDescription>
                {t('points_out_of', { score: attempt.score, total: assignmentTotal })}
              </CardDescription>
            </>
          ) : gradableCount === 0 ? (
            // Nothing was auto-graded, so there is no percentage to show at all.
            <>
              <CardTitle className="text-3xl">{t('open_only_title')}</CardTitle>
              <CardDescription>{t('open_only_desc', { count: openCount })}</CardDescription>
            </>
          ) : openCount > 0 ? (
            // Mixed quiz: the closed denominator is the only honest one, so the
            // mandated „X z Y pytań zamkniętych” headline replaces the percentage.
            <>
              <CardTitle className="text-3xl">
                {t('correct_closed', { score: attempt.score, total: gradableCount })}
              </CardTitle>
              <CardDescription>{t('open_questions_line', { count: openCount })}</CardDescription>
            </>
          ) : (
            <>
              <CardTitle className="text-3xl">
                {t('score_percent', { percentage: gradablePercentage })}
              </CardTitle>
              <CardDescription>
                {t('correct_of', { score: attempt.score, total: gradableCount })}
              </CardDescription>
            </>
          )}
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <span>{formatDate(attempt.started_at, locale)}</span>
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4">
        {attempt.questions.map((q, i) => {
          const userAnswer = attempt.answers[q.id];
          const isCorrect = userAnswer?.is_correct ?? false;
          const isOpenQuestion = q.type === 'open';

          return (
            <Card key={q.id}>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{t('question_short', { number: i + 1 })}</Badge>
                  <Badge variant="outline">{typeLabel(q.type)}</Badge>
                  {isOpenQuestion ? (
                    // A practice attempt has no reviewer, so „pending review”
                    // would be a promise nobody keeps (#329).
                    <Badge variant="outline" className="ml-auto">
                      {isAssignment ? t('badge_pending_review') : t('badge_self_check')}
                    </Badge>
                  ) : (
                    <Badge variant={isCorrect ? 'default' : 'destructive'} className="ml-auto">
                      {isCorrect ? t('badge_correct') : t('badge_incorrect')}
                    </Badge>
                  )}
                </div>
                <CardTitle className="mt-2 text-lg">{q.content}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {q.type === 'mcq' && (
                  <div className="flex flex-col gap-2">
                    {q.question_answers.map((a) => {
                      const isCorrectAnswer = a.is_correct;
                      const isSelected = a.id === userAnswer?.selected_answer_id;
                      return (
                        <div
                          key={a.id}
                          data-correct={isCorrectAnswer}
                          data-selected={isSelected && !isCorrectAnswer}
                          className="rounded-lg border p-3 data-[correct=true]:border-green-200 data-[correct=true]:bg-green-50 data-[selected=true]:border-red-200 data-[selected=true]:bg-red-50 dark:data-[correct=true]:border-green-900 dark:data-[correct=true]:bg-green-950/40 dark:data-[selected=true]:border-red-900 dark:data-[selected=true]:bg-red-950/40"
                        >
                          <div className="flex items-center gap-2">
                            {isCorrectAnswer && (
                              <CheckCircle
                                className="size-4 shrink-0 text-green-600 dark:text-green-400"
                                aria-label={t('badge_correct')}
                              />
                            )}
                            {isSelected && !isCorrectAnswer && (
                              <XCircle
                                className="size-4 shrink-0 text-red-600 dark:text-red-400"
                                aria-label={t('badge_incorrect')}
                              />
                            )}
                            <span
                              className={
                                isSelected && !isCorrectAnswer
                                  ? 'text-muted-foreground line-through'
                                  : ''
                              }
                            >
                              {a.content}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {q.type === 'true_false' && (
                  <div className="grid grid-cols-2 gap-3">
                    {q.question_answers.map((a) => {
                      const isCorrectAnswer = a.is_correct;
                      const isSelected = a.id === userAnswer?.selected_answer_id;
                      return (
                        <Button
                          key={a.id}
                          variant={
                            isCorrectAnswer ? 'default' : isSelected ? 'destructive' : 'outline'
                          }
                          className="h-16 gap-2 text-lg"
                          disabled
                        >
                          {isCorrectAnswer && (
                            <CheckCircle
                              className="size-4 shrink-0"
                              aria-label={t('badge_correct')}
                            />
                          )}
                          {isSelected && !isCorrectAnswer && (
                            <XCircle
                              className="size-4 shrink-0"
                              aria-label={t('badge_incorrect')}
                            />
                          )}
                          {a.content}
                        </Button>
                      );
                    })}
                  </div>
                )}
                {q.type === 'open' && (
                  <div className="rounded-lg border bg-muted p-3">
                    <span className="text-sm text-muted-foreground">{t('your_answer')}: </span>
                    <span className="font-medium whitespace-pre-wrap">
                      {userAnswer?.text_answer || t('no_answer')}
                    </span>
                  </div>
                )}
                {q.explanation && (
                  <div className="rounded-lg border bg-blue-50 p-3 text-sm dark:bg-blue-950/30">
                    <span className="font-medium">{t('explanation')}: </span>
                    {q.explanation}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
