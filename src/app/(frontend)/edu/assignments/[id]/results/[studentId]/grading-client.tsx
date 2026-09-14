'use client';

import { ArrowLeft, Check, ImageIcon } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useApiMutation, useApiQuery } from '@/hooks/use-api';
import { assignmentKeys } from '@/lib/query-keys';

interface StudentAnswers {
  id: string;
  user_id: string;
  score: number;
  total_questions: number;
  graded_at: string | null;
  quiz_attempt_questions: Array<{
    question_id: string;
    order_index: number;
    question: {
      id: string;
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
    id: string;
    question_id: string;
    selected_answer_id: string | null;
    is_correct: boolean;
    teacher_points: number | null;
    teacher_feedback: string | null;
  }>;
  assignment_answer_images: Array<{
    id: string;
    question_id: string;
    image_url: string;
  }>;
}

export default function StudentGradingClient() {
  const { id, studentId } = useParams<{ id: string; studentId: string }>();
  const t = useTranslations('EduGradingPage');
  const [grades, setGrades] = useState<Record<string, { points: string; feedback: string }>>({});

  const { data: attempt, isLoading } = useApiQuery<StudentAnswers>({
    queryKey: assignmentKeys.studentResults(id, studentId),
    url: `/api/v1/teacher/assignments/${id}/results/${studentId}`,
  });

  const gradeMutation = useApiMutation({
    mutationFn: async ({
      questionId,
      points,
      feedback,
    }: {
      questionId: string;
      points: number;
      feedback?: string;
    }) => {
      const res = await fetch(`/api/v1/teacher/assignments/${id}/results/${studentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId, points, feedback }),
      });
      if (!res.ok) throw new Error(t('grade_failed'));
    },
    invalidateKeys: [assignmentKeys.studentResults(id, studentId)],
  });

  const getGrade = (questionId: string) => {
    return grades[questionId] ?? { points: '', feedback: '' };
  };

  const setGrade = (questionId: string, field: 'points' | 'feedback', value: string) => {
    setGrades((prev) => ({
      ...prev,
      [questionId]: { ...prev[questionId], [field]: value },
    }));
  };

  const handleGrade = async (questionId: string) => {
    const g = getGrade(questionId);
    await gradeMutation.mutateAsync({
      questionId,
      points: parseInt(g.points, 10) || 0,
      feedback: g.feedback || undefined,
    });
  };

  const _getSelectedAnswerContent = (questionId: string) => {
    const answer = attempt?.quiz_answers?.find((a) => a.question_id === questionId);
    if (!answer) return null;
    return {
      selectedAnswerId: answer.selected_answer_id,
      teacherPoints: answer.teacher_points,
      teacherFeedback: answer.teacher_feedback,
    };
  };

  const getImages = (questionId: string) => {
    return attempt?.assignment_answer_images?.filter((img) => img.question_id === questionId) ?? [];
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-32 bg-muted animate-pulse rounded-lg" />
        ))}
      </div>
    );
  }

  if (!attempt) {
    return <div className="p-6 text-center text-muted-foreground">{t('not_found')}</div>;
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href={`/edu/assignments/${id}/results`} className="hover:text-foreground">
          <ArrowLeft className="w-4 h-4 inline mr-1" />
          {t('back')}
        </Link>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('score', { earned: attempt.score, total: attempt.total_questions })}
            {attempt.graded_at && ` ${t('graded')}`}
          </p>
        </div>
      </div>

      <div className="space-y-6">
        {attempt.quiz_attempt_questions
          ?.sort((a, b) => a.order_index - b.order_index)
          .map((aq) => {
            const studentAnswer = attempt.quiz_answers?.find(
              (a) => a.question_id === aq.question_id,
            );
            const images = getImages(aq.question_id);
            const isAutoGraded = aq.question.type === 'mcq' || aq.question.type === 'true_false';

            return (
              <div key={aq.question_id} className="rounded-lg border p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-1 min-w-0 flex-1">
                    <p className="font-medium">{aq.question.content}</p>
                    <div className="flex items-center gap-2">
                      <span className="text-xs bg-muted px-1.5 py-0.5 rounded">
                        {aq.question.type}
                      </span>
                      {isAutoGraded && (
                        <span
                          className={`text-xs font-medium ${
                            studentAnswer?.is_correct ? 'text-green-600' : 'text-red-600'
                          }`}
                        >
                          {studentAnswer?.is_correct ? t('correct') : t('incorrect')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {aq.question.explanation && (
                  <p className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                    {t('correct_answer', { explanation: aq.question.explanation })}
                  </p>
                )}

                {isAutoGraded && studentAnswer?.selected_answer_id && (
                  <div className="text-sm space-y-1">
                    <p className="text-muted-foreground">
                      {t('selected_answer_id', { id: studentAnswer.selected_answer_id })}
                    </p>
                  </div>
                )}

                {!isAutoGraded && (
                  <div className="space-y-3">
                    {images.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {images.map((img) => (
                          <a key={img.id} href={img.image_url} target="_blank" rel="noreferrer">
                            <div className="flex items-center gap-1 text-xs text-primary hover:underline">
                              <ImageIcon className="w-3 h-3" />
                              {t('view_image')}
                            </div>
                          </a>
                        ))}
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>{t('points')}</Label>
                        <Input
                          type="number"
                          min={0}
                          placeholder="0"
                          value={getGrade(aq.question_id).points}
                          onChange={(e) => setGrade(aq.question_id, 'points', e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>{t('feedback')}</Label>
                        <Textarea
                          placeholder={t('feedback_placeholder')}
                          value={getGrade(aq.question_id).feedback}
                          onChange={(e) => setGrade(aq.question_id, 'feedback', e.target.value)}
                        />
                      </div>
                    </div>

                    <Button
                      size="sm"
                      onClick={() => handleGrade(aq.question_id)}
                      disabled={gradeMutation.isPending}
                    >
                      <Check className="w-3 h-3 mr-1" />
                      {gradeMutation.isPending ? t('saving') : t('save')}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}
