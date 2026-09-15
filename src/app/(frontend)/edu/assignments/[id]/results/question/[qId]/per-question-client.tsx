'use client';

import { Button, Input, Label, Textarea } from '@studiq/ui';
import { ArrowLeft, Check, ImageIcon } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useApiMutation, useApiQuery } from '@/hooks/use-api';
import { assignmentKeys } from '@/lib/query-keys';

interface ResultsData {
  id: string;
  user_id: string;
  score: number;
  total_questions: number;
  user: {
    id: string;
    full_name: string;
  };
  quiz_answers: Array<{
    question_id: string;
    selected_answer_id: string | null;
    is_correct: boolean;
    teacher_points: number | null;
    teacher_feedback: string | null;
  }>;
  assignment_answer_images: Array<{
    question_id: string;
    image_url: string;
  }>;
}

export default function PerQuestionGradingClient() {
  const { id, qId } = useParams<{ id: string; qId: string }>();
  const t = useTranslations('EduPerQuestionGradingPage');
  const [grades, setGrades] = useState<Record<string, { points: string; feedback: string }>>({});

  const { data: results, isLoading } = useApiQuery<ResultsData[]>({
    queryKey: assignmentKeys.results(id),
    url: `/api/v1/teacher/assignments/${id}/results`,
  });

  const gradeMutation = useApiMutation({
    mutationFn: async ({
      studentId,
      points,
      feedback,
    }: {
      studentId: string;
      points: number;
      feedback?: string;
    }) => {
      const res = await fetch(`/api/v1/teacher/assignments/${id}/results/${studentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId: qId, points, feedback }),
      });
      if (!res.ok) throw new Error(t('grade_failed'));
    },
    invalidateKeys: [assignmentKeys.results(id)],
  });

  const getGrade = (studentId: string) => grades[studentId] ?? { points: '', feedback: '' };

  const handleGrade = async (studentId: string) => {
    const g = getGrade(studentId);
    await gradeMutation.mutateAsync({
      studentId,
      points: parseInt(g.points, 10) || 0,
      feedback: g.feedback || undefined,
    });
  };

  const getStudentAnswer = (studentId: string) => {
    const attempt = results?.find((r) => r.user_id === studentId);
    if (!attempt) return null;
    const answer = attempt.quiz_answers?.find((a) => a.question_id === qId);
    const images = attempt.assignment_answer_images?.filter((img) => img.question_id === qId) ?? [];
    return { answer, images, userName: attempt.user?.full_name ?? t('unknown') };
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-8 w-64 bg-muted animate-pulse rounded" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />
        ))}
      </div>
    );
  }

  const studentsWithOpen =
    results?.filter((r) =>
      r.quiz_answers?.some((a) => a.question_id === qId && a.teacher_points === null),
    ) ?? [];

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href={`/edu/assignments/${id}/results`} className="hover:text-foreground">
          <ArrowLeft className="w-4 h-4 inline mr-1" />
          {t('back')}
        </Link>
      </div>

      <div className="sticky top-0 bg-background z-10 pb-4 border-b">
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('need_grading', { count: studentsWithOpen.length })}
        </p>
      </div>

      <div className="space-y-4">
        {results?.map((attempt) => {
          const studentData = getStudentAnswer(attempt.user_id);
          if (!studentData?.answer) return null;

          return (
            <div key={attempt.user_id} className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-medium text-sm">{studentData.userName}</p>
                {studentData.answer.teacher_points !== null && (
                  <span className="text-xs text-green-600 font-medium">
                    {t('graded_points', { points: studentData.answer.teacher_points })}
                  </span>
                )}
              </div>

              {studentData.images.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {studentData.images.map((img, i) => (
                    <a key={i} href={img.image_url} target="_blank" rel="noreferrer">
                      <div className="flex items-center gap-1 text-xs text-primary hover:underline">
                        <ImageIcon className="w-3 h-3" />
                        {t('view_image')}
                      </div>
                    </a>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs">{t('points')}</Label>
                  <Input
                    type="number"
                    min={0}
                    placeholder="0"
                    value={getGrade(attempt.user_id).points}
                    onChange={(e) =>
                      setGrades((prev) => ({
                        ...prev,
                        [attempt.user_id]: { ...prev[attempt.user_id], points: e.target.value },
                      }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t('feedback')}</Label>
                  <Textarea
                    placeholder={t('feedback_placeholder')}
                    value={getGrade(attempt.user_id).feedback}
                    onChange={(e) =>
                      setGrades((prev) => ({
                        ...prev,
                        [attempt.user_id]: { ...prev[attempt.user_id], feedback: e.target.value },
                      }))
                    }
                  />
                </div>
              </div>

              <Button
                size="sm"
                onClick={() => handleGrade(attempt.user_id)}
                disabled={gradeMutation.isPending}
              >
                <Check className="w-3 h-3 mr-1" />
                {gradeMutation.isPending ? t('saving') : t('save')}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
