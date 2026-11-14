'use client';

import { Button, Card } from '@studiq/ui';
import { Eye } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { questionReviewLabels, scoreSummaryLabels } from '@/components/quiz/quiz-review-labels';
import { QuizQuestionReview } from '@/components/quiz/quiz-question-review';
import { QuizScoreSummary } from '@/components/quiz/quiz-score-summary';
import { EntityNotFound } from '@/components/shared/entity-not-found';
import { apiGet } from '@/lib/api';

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

export default function QuizReviewPage() {
  const params = useParams<{ attemptId: string }>();
  const attemptId = params.attemptId;
  const locale = useLocale();
  const t = useTranslations('AppQuizReviewPage');

  const [attempt, setAttempt] = useState<AttemptDetails | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<AttemptDetails>(`/api/v1/quiz/${attemptId}`)
      .then((data) => {
        setAttempt(data);
        setLoading(false);
        return undefined;
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

      <Card className="px-6">
        <QuizScoreSummary
          attempt={{
            score: attempt.score,
            totalQuestions: attempt.total_questions,
            totalPoints: attempt.total_points,
            isAssignment,
            startedAt: attempt.started_at,
            questions: attempt.questions,
          }}
          locale={locale}
          labels={scoreSummaryLabels(t)}
        />
      </Card>

      <div className="flex flex-col gap-4">
        {attempt.questions.map((question, index) => (
          <QuizQuestionReview
            key={question.id}
            question={question}
            answer={attempt.answers[question.id]}
            isAssignment={isAssignment}
            labels={questionReviewLabels(t, { number: index + 1, type: question.type })}
          />
        ))}
      </div>
    </div>
  );
}
