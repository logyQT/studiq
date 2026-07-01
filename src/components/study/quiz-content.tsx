'use client';

import { ListChecks, Lock, Play, Plus, RotateCcw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldContent, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { useApiQuery } from '@/hooks/use-api';
import { useFeature } from '@/hooks/use-feature';
import { apiPost } from '@/lib/api';

interface QuizAttempt {
  id: string;
  score: number;
  total_questions: number;
  config: {
    subjectId?: string;
    questionTypes?: string[];
    questionCount?: number;
  } | null;
  started_at: string;
  completed_at: string | null;
}

interface Subject {
  id: string;
  name: string;
}

const QUESTION_TYPE_OPTIONS = [
  { value: 'mcq', label: 'MCQ' },
  { value: 'true_false', label: 'True/False' },
  { value: 'open', label: 'Open' },
] as const;

export function QuizContent() {
  const t = useTranslations('AppFlashcardStudyPage');
  const router = useRouter();
  const { hasAccess } = useFeature('test.create');

  const { data: subjectsData } = useApiQuery<{ items: Subject[] }>({
    queryKey: ['subjects'],
    url: '/api/v1/subjects',
  });
  const subjects = subjectsData?.items;

  const { data: attemptsData } = useApiQuery<QuizAttempt[]>({
    queryKey: ['quiz', 'attempts'],
    url: '/api/v1/quiz/attempts',
  });
  const attempts = attemptsData;

  const [quizSubjectId, setQuizSubjectId] = useState<string>('');
  const [quizTypes, setQuizTypes] = useState<string[]>([]);
  const [quizCount, setQuizCount] = useState(10);
  const [quizSubmitting, setQuizSubmitting] = useState(false);

  const inProgressAttempt = attempts?.find((a) => !a.completed_at) ?? null;

  function toggleQuizType(type: string) {
    setQuizTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  }

  async function handleGenerateQuiz() {
    setQuizSubmitting(true);
    try {
      const data = await apiPost<{ id: string }>('/api/v1/quiz/new', {
        ...(quizSubjectId ? { subjectId: quizSubjectId } : {}),
        ...(quizTypes.length > 0 ? { questionTypes: quizTypes } : {}),
        questionCount: quizCount,
      });
      router.push(`/app/study/session/quiz/${data.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('NOT_FOUND')) {
        toast.error('No questions found matching your criteria. Create some questions first!');
      } else if (msg.includes('BAD_REQUEST')) {
        toast.error('Not enough questions available. Try fewer questions or add more content.');
      } else if (msg.includes('UNPROCESSABLE_ENTITY')) {
        toast.error('Please select at least one question type');
      } else {
        toast.error('Failed to generate quiz');
      }
    } finally {
      setQuizSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {inProgressAttempt && (
        <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20">
          <CardContent className="flex items-center justify-between gap-4 py-4">
            <div className="min-w-0">
              <p className="font-semibold text-sm flex items-center gap-2">
                <RotateCcw className="size-4 text-amber-600 shrink-0" />
                {t('in_progress_quiz')}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{t('in_progress_desc')}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                onClick={() => router.push(`/app/study/session/quiz/${inProgressAttempt.id}`)}
              >
                <Play className="size-3.5" /> {t('continue_quiz')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => toast.info(t('abort_coming_soon'))}
              >
                <Trash2 className="size-3.5" /> {t('abort_quiz')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">{t('quiz_desc')}</p>
        <Link
          href="/app/stats/results"
          className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4 transition-colors shrink-0"
        >
          {t('view_full_history')} &rarr;
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="size-5" /> {t('new_quiz')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field orientation="vertical">
              <FieldLabel>{t('quiz_subject')}</FieldLabel>
              <FieldContent>
                <Select value={quizSubjectId} onValueChange={setQuizSubjectId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t('quiz_subject_placeholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {subjects?.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldContent>
            </Field>

            <Field orientation="vertical">
              <FieldLabel>{t('quiz_types')}</FieldLabel>
              <FieldContent>
                <div className="flex flex-wrap gap-3">
                  {QUESTION_TYPE_OPTIONS.map((opt) => (
                    <div key={opt.value} className="flex items-center gap-2">
                      <Checkbox
                        checked={quizTypes.includes(opt.value)}
                        onCheckedChange={() => toggleQuizType(opt.value)}
                        id={`quiz-type-${opt.value}`}
                      />
                      <Label htmlFor={`quiz-type-${opt.value}`}>{opt.label}</Label>
                    </div>
                  ))}
                </div>
              </FieldContent>
            </Field>

            <Field orientation="vertical">
              <FieldLabel>{t('quiz_count')}</FieldLabel>
              <FieldContent>
                <div className="flex items-center gap-4">
                  <Slider
                    value={[quizCount]}
                    onValueChange={([v]) => setQuizCount(v)}
                    min={1}
                    max={50}
                    step={1}
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    value={quizCount}
                    onChange={(e) =>
                      setQuizCount(Math.max(1, Math.min(50, parseInt(e.target.value, 10) || 1)))
                    }
                    className="w-16 text-center"
                    onFocus={(e) => e.target.select()}
                  />
                </div>
              </FieldContent>
            </Field>
          </FieldGroup>

          <Button
            className="mt-6 w-full"
            disabled={!hasAccess || quizSubmitting || quizTypes.length === 0}
            onClick={
              hasAccess
                ? handleGenerateQuiz
                : () => router.push('/checkout?plan_id=student_premium')
            }
          >
            {hasAccess ? (
              <>
                <ListChecks data-icon="inline-start" /> {t('generate_quiz')}
              </>
            ) : (
              <>
                <Lock className="size-3" /> Upgrade
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
