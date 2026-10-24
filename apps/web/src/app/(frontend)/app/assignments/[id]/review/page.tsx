'use client';

import { ArrowLeft, CheckCircle, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useApiQuery } from '@/hooks/use-api';
import { reviewAttemptId, type StudentAssignmentAttemptState } from '@/lib/assignment-attempts';
import { studentAssignmentKeys } from '@/lib/query-keys';

interface ReviewQuestion {
  id: string;
  content: string;
  type: string;
  explanation: string | null;
  question_answers: Array<{ id: string; content: string; is_correct: boolean }>;
}

interface ReviewAnswer {
  selected_answer_id: string | null;
  text_answer: string | null;
  is_correct: boolean;
  teacher_points: number | null;
  teacher_feedback: string | null;
}

interface ReviewData {
  id: string;
  assignment_id: string | null;
  score: number;
  total_questions: number;
  total_points: number | null;
  completed_at: string | null;
  questions: ReviewQuestion[];
  answers: Record<string, ReviewAnswer>;
}

export default function ReviewAssignmentPage() {
  const t = useTranslations('AppAssignmentReviewPage');
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const attemptIdParam = searchParams.get('attemptId');

  // A bookmarked /review URL has no attempt id; fall back to the latest
  // submitted attempt — the same row the detail page links to.
  const { data: assignment, isLoading: isAssignmentLoading } = useApiQuery<
    StudentAssignmentAttemptState & { id: string }
  >({
    queryKey: studentAssignmentKeys.detail(id),
    url: `/api/v1/assignments/${id}`,
    enabled: !attemptIdParam,
    staleTime: 0,
  });

  const attemptId = reviewAttemptId(attemptIdParam, assignment);

  const { data: review, isLoading: isReviewLoading } = useApiQuery<ReviewData>({
    queryKey: ['assignment-review', attemptId],
    url: `/api/v1/quiz/${attemptId}`,
    enabled: !!attemptId,
    // Review data changes when a teacher grades/leaves feedback; the default
    // Infinity would keep a pre-grading snapshot for 30 min.
    staleTime: 0,
  });

  if (isAssignmentLoading || isReviewLoading) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-4">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="h-64 bg-muted animate-pulse rounded-lg" />
      </div>
    );
  }

  // A stale/mismatched attempt id must not render another assignment's review,
  // and a running attempt has no answer key to show yet.
  if (!review?.completed_at || review.assignment_id !== id) {
    return <div className="p-6 text-center text-muted-foreground">{t('not_available')}</div>;
  }

  const total = review.total_points || review.total_questions;

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <Link
        href={`/app/assignments/${id}`}
        className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
      >
        <ArrowLeft className="w-4 h-4" /> {t('back')}
      </Link>

      <div className="text-center py-8">
        <h1 className="text-3xl font-bold">
          {review.score} / {total}
        </h1>
        <p className="text-muted-foreground mt-1">
          {total > 0 ? Math.round((review.score / total) * 100) : 0}%
        </p>
      </div>

      <div className="space-y-4">
        {(review.questions ?? []).map((q) => {
          const answer = review.answers?.[q.id];
          const isOpen = q.type === 'open';

          return (
            <div key={q.id} className="rounded-lg border p-4 space-y-3">
              <div className="flex items-start gap-3">
                {!isOpen &&
                  (answer?.is_correct ? (
                    <CheckCircle
                      className="w-5 h-5 text-green-600 shrink-0 mt-0.5"
                      aria-label={t('correct')}
                    />
                  ) : (
                    <XCircle
                      className="w-5 h-5 text-red-600 shrink-0 mt-0.5"
                      aria-label={t('incorrect')}
                    />
                  ))}
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{q.content}</p>
                  {isOpen && (
                    <p className="text-sm text-muted-foreground mt-1">
                      {t('your_answer')}:{' '}
                      <span className="whitespace-pre-wrap font-medium text-foreground">
                        {answer?.text_answer || t('no_answer')}
                      </span>
                    </p>
                  )}
                  {isOpen &&
                    answer &&
                    answer.teacher_points == null &&
                    !answer.teacher_feedback && (
                      <p className="text-sm text-muted-foreground mt-1">{t('pending_review')}</p>
                    )}
                  {answer?.teacher_points != null && (
                    <p className="text-sm text-green-700 mt-1">
                      {t('points_awarded', { points: answer.teacher_points })}
                    </p>
                  )}
                  {answer?.teacher_feedback && (
                    <p className="text-sm text-blue-600 mt-1">
                      {t('feedback', { text: answer.teacher_feedback })}
                    </p>
                  )}
                </div>
              </div>

              {!isOpen && q.question_answers.length > 0 && (
                <div className="flex flex-col gap-2">
                  {q.question_answers.map((option) => {
                    const isSelected = option.id === answer?.selected_answer_id;
                    const isCorrectOption = option.is_correct;
                    const isWrongSelection = isSelected && !isCorrectOption;

                    return (
                      <div
                        key={option.id}
                        data-correct={isCorrectOption}
                        data-selected={isWrongSelection}
                        className="rounded-lg border p-3 data-[correct=true]:border-green-200 data-[correct=true]:bg-green-50 data-[selected=true]:border-red-200 data-[selected=true]:bg-red-50"
                      >
                        <div className="flex items-center gap-2">
                          {isCorrectOption && (
                            <CheckCircle
                              className="w-4 h-4 text-green-600 shrink-0"
                              aria-label={t('correct')}
                            />
                          )}
                          {isWrongSelection && (
                            <XCircle
                              className="w-4 h-4 text-red-600 shrink-0"
                              aria-label={t('incorrect')}
                            />
                          )}
                          <span
                            className={isWrongSelection ? 'text-muted-foreground line-through' : ''}
                          >
                            {option.content}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {q.explanation && (
                <div className="rounded-lg border bg-blue-50 p-3 text-sm">
                  <span className="font-medium">{t('explanation')}: </span>
                  {q.explanation}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
