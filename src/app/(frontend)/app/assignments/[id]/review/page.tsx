'use client';

import { ArrowLeft, CheckCircle, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useApiQuery } from '@/hooks/use-api';

interface ReviewData {
  id: string;
  score: number;
  total_questions: number;
  quiz_attempt_questions: Array<{
    question_id: string;
    order_index: number;
    question: {
      content: string;
      type: string;
      explanation: string | null;
      question_answers: Array<{
        id: string;
        content: string;
        is_correct: boolean;
      }>;
    };
  }>;
  quiz_answers: Array<{
    question_id: string;
    selected_answer_id: string | null;
    is_correct: boolean;
    teacher_points: number | null;
    teacher_feedback: string | null;
  }>;
}

export default function ReviewAssignmentPage() {
  const t = useTranslations('AppAssignmentReviewPage');
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const attemptId = searchParams.get('attemptId');

  const { data: review, isLoading } = useApiQuery<ReviewData>({
    queryKey: ['assignment-review', attemptId ?? id],
    url: attemptId ? `/api/v1/quiz/${attemptId}` : `/api/v1/quiz/attempts/${id}`,
  });

  if (isLoading) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-4">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="h-64 bg-muted animate-pulse rounded-lg" />
      </div>
    );
  }

  if (!review) {
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

      <div className="text-center py-8">
        <h1 className="text-3xl font-bold">
          {review.score} / {review.total_questions}
        </h1>
        <p className="text-muted-foreground mt-1">
          {Math.round((review.score / review.total_questions) * 100)}%
        </p>
      </div>

      <div className="space-y-4">
        {review.quiz_attempt_questions?.map((aq) => {
          const answer = review.quiz_answers?.find((a) => a.question_id === aq.question_id);
          const isMcqOrTf = aq.question.type === 'mcq' || aq.question.type === 'true_false';

          return (
            <div key={aq.question_id} className="rounded-lg border p-4 space-y-2">
              <div className="flex items-start gap-3">
                {isMcqOrTf &&
                  (answer?.is_correct ? (
                    <CheckCircle className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                  ))}
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{aq.question.content}</p>
                  {aq.question.explanation && (
                    <p className="text-sm text-muted-foreground mt-1">{aq.question.explanation}</p>
                  )}
                  {answer?.teacher_feedback && (
                    <p className="text-sm text-blue-600 mt-1">
                      {t('feedback', { text: answer.teacher_feedback })}
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
