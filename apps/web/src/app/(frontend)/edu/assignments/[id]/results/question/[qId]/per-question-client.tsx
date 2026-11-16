'use client';

import { Button, Input, Label, Textarea } from '@studiq/ui';
import { ArrowLeft, Check, ImageIcon } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { usePerQuestionGrading } from '@/hooks/use-grading-actions';
import { type GradeDraft, parseGradePoints, resolveGradeDraft } from '@/lib/grading';

interface ResultsData {
  id: string;
  user_id: string;
  score: number;
  total_questions: number;
  user: {
    id: string;
    full_name: string | null;
  } | null;
  /**
   * Optional on purpose: this is a wire payload, and an answer embed that stops
   * arriving must leave an empty card, never crash the page (#1230).
   */
  quiz_answers?: Array<{
    question_id: string;
    text_answer: string | null;
    teacher_points: number | null;
    teacher_feedback: string | null;
  }>;
  assignment_answer_images?: Array<{
    question_id: string;
    image_url: string;
  }>;
}

export default function PerQuestionGradingClient() {
  const { id, qId } = useParams<{ id: string; qId: string }>();
  const t = useTranslations('EduPerQuestionGradingPage');
  const [grades, setGrades] = React.useState<Record<string, Partial<GradeDraft>>>({});

  const {
    resultsQuery: { isLoading },
    attempts,
    gradeMutation,
  } = usePerQuestionGrading<ResultsData>(id, t('grade_failed'));

  const attemptOf = (studentId: string) => attempts?.find((r) => r.user_id === studentId);

  const answerOf = (attempt: ResultsData | undefined) =>
    attempt?.quiz_answers?.find((a) => a.question_id === qId);

  const getSavedGrade = (studentId: string) => answerOf(attemptOf(studentId));

  const getGrade = (studentId: string) =>
    resolveGradeDraft(getSavedGrade(studentId), grades[studentId]);

  const handleGrade = async (studentId: string) => {
    const g = getGrade(studentId);
    const points = parseGradePoints(g.points);
    // The grading route addresses an attempt; this view has no attempt dimension.
    const attemptId = attemptOf(studentId)?.id;
    if (points === null || !attemptId) return;
    try {
      await gradeMutation.mutateAsync({
        attemptId,
        questionId: qId,
        points,
        feedback: g.feedback,
      });
    } catch {
      // Handled via gradeMutation.onError
    }
  };

  const getStudentAnswer = (attempt: ResultsData) => ({
    answer: answerOf(attempt),
    images: (attempt.assignment_answer_images ?? []).filter((img) => img.question_id === qId),
    userName: attempt.user?.full_name ?? t('unknown'),
  });

  /** An attempt whose answer for this question is missing or still ungraded. */
  const needsGrading = (attempt: ResultsData) => {
    const points = answerOf(attempt)?.teacher_points;
    return points === null || points === undefined;
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

  const pending = attempts?.filter(needsGrading) ?? [];

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <Link
          href={`/edu/assignments/${id}/results`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" />
          {t('back')}
        </Link>
      </div>

      <div className="sticky top-0 bg-background z-10 pb-4 border-b">
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('need_grading', { count: pending.length })}
        </p>
      </div>

      <div className="space-y-4">
        {attempts?.map((attempt) => {
          const studentData = getStudentAnswer(attempt);
          const grade = getGrade(attempt.user_id);
          const isValidPoints = parseGradePoints(grade.points) !== null;
          const gradedPoints = studentData.answer?.teacher_points ?? null;

          return (
            <div key={attempt.user_id} className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-medium text-sm">{studentData.userName}</p>
                {gradedPoints !== null && (
                  <span className="text-xs text-green-600 font-medium">
                    {t('graded_points', { points: gradedPoints })}
                  </span>
                )}
              </div>

              {studentData.answer?.text_answer ? (
                <p className="text-sm">
                  {t('student_answer', { text: studentData.answer.text_answer })}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">{t('no_answer')}</p>
              )}

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
                    step={1}
                    placeholder="0"
                    value={grade.points}
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
                    value={grade.feedback}
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
                disabled={gradeMutation.isPending || !isValidPoints}
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
