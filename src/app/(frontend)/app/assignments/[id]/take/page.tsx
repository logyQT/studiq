'use client';

import { ArrowLeft, Check, Clock, ImagePlus, Upload } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { useApiMutation, useApiQuery } from '@/hooks/use-api';

interface AttemptData {
  id: string;
  questions: Array<{
    id: string;
    content: string;
    type: string;
    question_answers?: Array<{
      id: string;
      content: string;
      is_correct: boolean;
    }>;
  }>;
}

export default function TakeAssignmentPage() {
  const t = useTranslations('AppAssignmentTakePage');
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const attemptId = searchParams.get('attemptId');

  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  const deadlineParam = searchParams.get('deadline');

  useEffect(() => {
    if (!deadlineParam) return;
    const update = () => {
      setRemainingMs(Math.max(0, new Date(deadlineParam).getTime() - Date.now()));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [deadlineParam]);

  const { data: attempt, isLoading } = useApiQuery<AttemptData>({
    queryKey: ['assignment-attempt', attemptId ?? ''],
    url: `/api/v1/quiz/${attemptId}`,
    enabled: !!attemptId,
  });

  const submitMutation = useApiMutation({
    mutationFn: async (body: {
      attemptId: string;
      answers: Array<{ questionId: string; selectedAnswerId?: string }>;
    }) => {
      const res = await fetch(`/api/v1/quiz/${body.attemptId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attemptId: body.attemptId, answers: body.answers }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      return json.data;
    },
  });

  const handleUploadImage = useCallback(
    async (questionId: string, file: File) => {
      setUploading((prev) => ({ ...prev, [questionId]: true }));
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('attemptId', attemptId ?? '');
        formData.append('questionId', questionId);

        const res = await fetch(`/api/v1/assignments/${id}/upload-image`, {
          method: 'POST',
          body: formData,
        });
        if (!res.ok) throw new Error(t('upload_failed'));
      } finally {
        setUploading((prev) => ({ ...prev, [questionId]: false }));
      }
    },
    [id, attemptId, t],
  );

  const performSubmit = useCallback(async () => {
    if (!attempt) return;
    setSubmitting(true);

    const formattedAnswers = Object.entries(answers).map(([questionId, selectedAnswerId]) => ({
      questionId,
      selectedAnswerId: selectedAnswerId || undefined,
    }));

    await submitMutation.mutateAsync({ attemptId: attempt.id, answers: formattedAnswers });
    router.push(`/app/assignments/${id}/review`);
  }, [attempt, answers, submitMutation, id, router]);

  const handleSubmit = performSubmit;

  useEffect(() => {
    if (remainingMs === 0 && attempt && !submitting) {
      performSubmit();
    }
  }, [remainingMs, attempt, submitting, performSubmit]);

  if (isLoading || !attempt) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-4">
        <div className="h-8 w-64 bg-muted animate-pulse rounded" />
        <div className="h-64 bg-muted animate-pulse rounded-lg" />
      </div>
    );
  }

  const question = attempt.questions?.[currentIndex];
  if (!question) return null;

  const isMcq = question.type === 'mcq' || question.type === 'true_false';
  const isOpen = question.type === 'open';
  const progress = `${currentIndex + 1} / ${attempt.questions?.length ?? 0}`;

  const remainingSeconds = remainingMs !== null ? Math.floor(remainingMs / 1000) : null;
  const minutesLeft = remainingSeconds !== null ? Math.floor(remainingSeconds / 60) : null;
  const secondsLeft = remainingSeconds !== null ? remainingSeconds % 60 : null;

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href={`/app/assignments/${id}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4 inline mr-1" />
          {t('quit')}
        </Link>
        {remainingMs !== null && remainingMs > 0 && (
          <span
            className={`text-sm font-mono ${remainingMs < 60000 ? 'text-red-600 font-bold' : 'text-muted-foreground'}`}
          >
            <Clock className="w-3 h-3 inline mr-1" />
            {minutesLeft}:{String(secondsLeft).padStart(2, '0')}
          </span>
        )}
        {remainingMs === 0 && (
          <span className="text-sm text-red-600 font-bold">Time&rsquo;s up!</span>
        )}
        <span className="text-sm text-muted-foreground">{progress}</span>
      </div>

      <div className="w-full bg-muted rounded-full h-1.5">
        <div
          className="bg-primary h-1.5 rounded-full transition-all"
          style={{ width: `${((currentIndex + 1) / (attempt.questions?.length ?? 1)) * 100}%` }}
        />
      </div>

      <div className="rounded-lg border p-6 space-y-6">
        <p className="text-lg font-medium">{question.content}</p>

        {isMcq && question.question_answers && (
          <RadioGroup
            value={answers[question.id] ?? ''}
            onValueChange={(val) => setAnswers((prev) => ({ ...prev, [question.id]: val }))}
          >
            <div className="space-y-3">
              {question.question_answers.map((ans) => (
                <div
                  key={ans.id}
                  className="flex items-center gap-3 p-3 rounded-lg border hover:bg-accent/50 cursor-pointer"
                >
                  <RadioGroupItem value={ans.id} id={ans.id} />
                  <Label htmlFor={ans.id} className="cursor-pointer flex-1">
                    {ans.content}
                  </Label>
                </div>
              ))}
            </div>
          </RadioGroup>
        )}

        {isOpen && (
          <div className="space-y-4">
            <Textarea
              placeholder={t('answer_placeholder')}
              value={answers[question.id] ?? ''}
              onChange={(e) => setAnswers((prev) => ({ ...prev, [question.id]: e.target.value }))}
              rows={6}
            />

            <div className="space-y-2">
              <Label>{t('upload_image')}</Label>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploading[question.id]}
                  onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/*';
                    input.onchange = async (e) => {
                      const file = (e.target as HTMLInputElement).files?.[0];
                      if (file) await handleUploadImage(question.id, file);
                    };
                    input.click();
                  }}
                >
                  {uploading[question.id] ? (
                    <>
                      <Upload className="w-4 h-4 mr-1 animate-pulse" /> {t('uploading')}
                    </>
                  ) : (
                    <>
                      <ImagePlus className="w-4 h-4 mr-1" /> {t('upload_photo')}
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
          disabled={currentIndex === 0}
        >
          {t('previous')}
        </Button>

        {currentIndex < (attempt.questions?.length ?? 1) - 1 ? (
          <Button onClick={() => setCurrentIndex((i) => i + 1)}>{t('next')}</Button>
        ) : (
          <Button onClick={handleSubmit} disabled={submitting}>
            <Check className="w-4 h-4 mr-1" />
            {submitting ? t('submitting') : t('submit')}
          </Button>
        )}
      </div>
    </div>
  );
}
