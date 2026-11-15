'use client';

import { ArrowLeft, CheckCircle, Lock, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useApiQuery } from '@/hooks/use-api';
import { useBreadcrumbLabel } from '@/hooks/use-breadcrumbs';
import { ApiError } from '@/lib/api';
import { studentAssignmentKeys } from '@/lib/query-keys';

interface ReviewedOption {
  id: string;
  content: string;
  isCorrect: boolean;
}

interface ReviewedItem {
  itemId: string;
  type: string;
  content: string;
  options: ReviewedOption[];
  explanation: string | null;
  modelAnswer: string | null;
  graded: boolean;
  correct: boolean | null;
  selectedOptionId: string | null;
  textAnswer: string | null;
  teacherPoints: number | null;
  teacherFeedback: string | null;
}

/** One submitted attempt as the review index shows it (R5/R19). */
interface ReviewedAttempt {
  attemptId: string;
  completedAt: string | null;
  score: { earned: number; possible: number } | null;
  ungradedCount: number;
}

interface AssignmentReview {
  assignmentId: string;
  attemptId: string | null;
  completedAt: string | null;
  score: { earned: number; possible: number } | null;
  ungradedCount: number;
  items: ReviewedItem[];
  attempts: ReviewedAttempt[];
}

export default function ReviewAssignmentPage() {
  const t = useTranslations('AppAssignmentReviewPage');
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const attemptIdParam = searchParams.get('attemptId');

  // The assignment is fetched for the breadcrumb; the review itself is the cohort artefact and
  // decides its own lock (R5).
  const { data: assignment, isLoading: isAssignmentLoading } = useApiQuery<{
    title: string;
    show_results: boolean;
  }>({
    queryKey: studentAssignmentKeys.detail(id),
    url: `/api/v1/assignments/${id}`,
    staleTime: 0,
  });
  useBreadcrumbLabel(id, assignment?.title);

  const resultsEnabled = assignment?.show_results !== false;
  const {
    data: review,
    isLoading,
    error,
  } = useApiQuery<AssignmentReview>({
    queryKey: ['assignment-review', id, attemptIdParam ?? ''],
    url: `/api/v1/assignments/${id}/review${attemptIdParam ? `?attemptId=${attemptIdParam}` : ''}`,
    // When the teacher never opted into results there is no review at any time (R5), so the page
    // does not fire a request it knows answers 404.
    enabled: !!assignment && resultsEnabled,
    retry: false,
    // A teacher may grade an open answer after the close; the review must not sit on a stale copy.
    staleTime: 0,
  });

  if (isAssignmentLoading || isLoading) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-4">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="h-64 bg-muted animate-pulse rounded-lg" />
      </div>
    );
  }

  const code = error instanceof ApiError ? error.code : null;

  // The key is the answer sheet while the window is open, so the review does not exist yet. This is
  // a state, not a failure: it says when the review opens.
  if (code === 'REVIEW_LOCKED') {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-4 text-center">
        <Lock className="w-8 h-8 mx-auto text-muted-foreground" />
        <h1 className="text-xl font-semibold">{t('locked')}</h1>
        <p className="text-sm text-muted-foreground">{t('locked_hint')}</p>
        <Link href={`/app/assignments/${id}`} className="text-sm underline">
          {t('back')}
        </Link>
      </div>
    );
  }

  if (!review || error) {
    return <div className="p-6 text-center text-muted-foreground">{t('not_available')}</div>;
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <Link
        href={`/app/assignments/${id}`}
        className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
      >
        <ArrowLeft className="w-4 h-4" /> {t('back')}
      </Link>

      {review.score ? (
        <div className="text-center py-8">
          <h1 className="text-3xl font-bold">
            {review.score.earned} / {review.score.possible}
          </h1>
          <p className="text-muted-foreground mt-1">
            {Math.round((review.score.earned / review.score.possible) * 100)}%
          </p>
        </div>
      ) : (
        // A submitted sheet of open items has no score (R16): say that, instead of claiming the
        // student never sat the assessment.
        <p className="text-sm text-muted-foreground">
          {review.attemptId ? t('ungraded_only', { count: review.ungradedCount }) : t('no_attempt')}
        </p>
      )}

      {/* A retake is its own attempt with its own score (R5/R19), so the review can be read per
          attempt instead of only ever showing the latest one. */}
      {review.attempts.length > 1 && (
        <nav className="flex flex-wrap gap-2 text-sm" aria-label={t('attempts')}>
          {review.attempts.map((attempt, index) => {
            const isCurrent = attempt.attemptId === review.attemptId;
            return (
              <Link
                key={attempt.attemptId}
                href={`/app/assignments/${id}/review?attemptId=${attempt.attemptId}`}
                aria-current={isCurrent ? 'page' : undefined}
                className={`rounded-full border px-3 py-1 ${
                  isCurrent ? 'border-foreground font-medium' : 'text-muted-foreground'
                }`}
              >
                {t('attempt_n', { n: review.attempts.length - index })} ·{' '}
                {attempt.score
                  ? t('attempt_score', {
                      earned: attempt.score.earned,
                      possible: attempt.score.possible,
                    })
                  : t('attempt_ungraded', { count: attempt.ungradedCount })}
              </Link>
            );
          })}
        </nav>
      )}

      <div className="space-y-4">
        {review.items.map((item) => {
          const isOpen = item.type === 'open';

          return (
            <div key={item.itemId} className="rounded-lg border p-4 space-y-3">
              <div className="flex items-start gap-3">
                {item.graded &&
                  item.correct !== null &&
                  (item.correct ? (
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
                  <p className="font-medium">{item.content}</p>
                  {isOpen && review.attemptId && (
                    <p className="text-sm text-muted-foreground mt-1">
                      {t('your_answer')}:{' '}
                      <span className="whitespace-pre-wrap font-medium text-foreground">
                        {item.textAnswer || t('no_answer')}
                      </span>
                    </p>
                  )}
                  {isOpen && review.attemptId && item.teacherPoints == null && (
                    <p className="text-sm text-muted-foreground mt-1">{t('pending_review')}</p>
                  )}
                  {item.teacherPoints != null && (
                    <p className="text-sm text-green-700 mt-1">
                      {t('points_awarded', { points: item.teacherPoints })}
                    </p>
                  )}
                  {item.teacherFeedback && (
                    <p className="text-sm text-blue-600 mt-1">
                      {t('feedback', { text: item.teacherFeedback })}
                    </p>
                  )}
                </div>
              </div>

              {!isOpen && item.options.length > 0 && (
                <div className="flex flex-col gap-2">
                  {item.options.map((option) => {
                    const isSelected = option.id === item.selectedOptionId;
                    const isWrongSelection = isSelected && !option.isCorrect;

                    return (
                      <div
                        key={option.id}
                        data-correct={option.isCorrect}
                        data-selected={isWrongSelection}
                        className="rounded-lg border p-3 data-[correct=true]:border-green-200 data-[correct=true]:bg-green-50 data-[selected=true]:border-red-200 data-[selected=true]:bg-red-50"
                      >
                        <div className="flex items-center gap-2">
                          {option.isCorrect && (
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

              {!isOpen && item.explanation && (
                <div className="rounded-lg border bg-blue-50 p-3 text-sm">
                  <span className="font-medium">{t('explanation')}: </span>
                  {item.explanation}
                </div>
              )}

              {isOpen && (
                <div className="rounded-lg border bg-blue-50 p-3 text-sm">
                  <span className="font-medium">{t('model_answer')}: </span>
                  {/* A snapshot published before #1173 carries no model answer; say so rather
                      than render an empty box (R11: the frozen item is never re-derived). */}
                  {item.modelAnswer ?? t('model_answer_not_captured')}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
