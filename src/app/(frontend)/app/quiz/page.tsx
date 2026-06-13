'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Plus, Play, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { apiGet, apiPost } from '@/lib/api';

interface QuizAttempt {
  id: string;
  score: number;
  total_questions: number;
  config: {
    subjectId?: string;
    questionTypes?: string[];
    difficulty?: string;
    questionCount?: number;
  } | null;
  started_at: string;
  completed_at: string | null;
}

interface Subject {
  id: string;
  name: string;
}

export default function QuizPage() {
  const t = useTranslations('AppQuizPage');
  const router = useRouter();
  const [attempts, setAttempts] = useState<QuizAttempt[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    subjectId: 'none',
    questionTypes: ['mcq'] as string[],
    difficulty: 'mixed',
    questionCount: 10,
  });

  useEffect(() => {
    Promise.all([
      apiGet<QuizAttempt[]>('/api/v1/quiz/attempts').catch(() => [] as QuizAttempt[]),
      apiGet<Subject[]>('/api/v1/subjects').catch(() => [] as Subject[]),
    ])
      .then(([a, s]) => {
        setAttempts(a);
        setSubjects(s);
        setLoading(false);
      })
      .catch(() => {
        setAttempts([]);
        setSubjects([]);
        setLoading(false);
      });
  }, []);

  function toggleQuestionType(type: string) {
    setFormData((prev) => ({
      ...prev,
      questionTypes: prev.questionTypes.includes(type)
        ? prev.questionTypes.filter((t) => t !== type)
        : [...prev.questionTypes, type],
    }));
  }

  async function generateQuiz() {
    if (formData.questionTypes.length === 0) {
      toast.error(t('select_question_type'));
      return;
    }

    const body: Record<string, unknown> = {
      questionTypes: formData.questionTypes,
      difficulty: formData.difficulty,
      questionCount: formData.questionCount,
    };

    if (formData.subjectId !== 'none') {
      body.subjectId = formData.subjectId;
    }

    try {
      const data = await apiPost<{ id: string }>('/api/v1/quiz/new', body);
      setModalOpen(false);
      router.push(`/app/quiz/${data.id}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      if (msg === 'BAD_REQUEST') {
        toast.error(t('not_enough_questions'));
      } else {
        toast.error(msg || t('common_error'));
      }
    }
  }

  if (loading) return <div className="flex justify-center py-12">{t('common_loading')}</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">{t('title')}</h2>
        <Button onClick={() => setModalOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> {t('new_quiz')}
        </Button>
      </div>

      {attempts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground mb-4">
              {t('no_attempts')}
            </p>
            <Button onClick={() => setModalOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> {t('generate_quiz')}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {attempts.map((attempt) => {
            const percentage =
              attempt.total_questions > 0
                ? Math.round((attempt.score / attempt.total_questions) * 100)
                : 0;
            const isCompleted = attempt.completed_at !== null;

            return (
              <Card key={attempt.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{t('practice_quiz')}</CardTitle>
                    {isCompleted ? (
                      <Badge variant={percentage >= 70 ? 'default' : 'destructive'}>
                        {percentage}%
                      </Badge>
                    ) : (
                      <Badge variant="secondary">{t('in_progress')}</Badge>
                    )}
                  </div>
                  <CardDescription>
                    {new Date(attempt.started_at).toLocaleDateString()}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span>{t('questions_count', { count: attempt.total_questions })}</span>
                    {attempt.config?.difficulty && (
                      <>
                        <span>·</span>
                        <Badge variant="outline" className="text-xs">
                          {attempt.config.difficulty}
                        </Badge>
                      </>
                    )}
                  </div>
                </CardContent>
                <CardFooter>
                  {isCompleted ? (
                    <Link href={`/app/quiz/review/${attempt.id}`} className="w-full">
                      <Button variant="outline" className="w-full">
                        <Eye className="mr-2 h-4 w-4" /> {t('review')}
                      </Button>
                    </Link>
                  ) : (
                    <Link href={`/app/quiz/${attempt.id}`} className="w-full">
                      <Button className="w-full">
                        <Play className="mr-2 h-4 w-4" /> {t('resume')}
                      </Button>
                    </Link>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('generate_quiz_title')}</DialogTitle>
            <DialogDescription>{t('generate_quiz_desc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>{t('subject_label')}</Label>
              <Select
                value={formData.subjectId}
                onValueChange={(v) => setFormData({ ...formData, subjectId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('all_subjects')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('all_subjects')}</SelectItem>
                  {subjects.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>{t('question_types_label')}</Label>
              <div className="space-y-2 mt-2">
                {[
                  { value: 'mcq', label: t('type_mcq') },
                  { value: 'true_false', label: t('type_true_false') },
                  { value: 'open', label: t('type_open') },
                ].map((type) => (
                  <div key={type.value} className="flex items-center gap-3 p-2 rounded-lg border">
                    <Checkbox
                      checked={formData.questionTypes.includes(type.value)}
                      onCheckedChange={() => toggleQuestionType(type.value)}
                    />
                    <Label className="cursor-pointer flex-1">{type.label}</Label>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <Label>{t('difficulty_label')}</Label>
              <Select
                value={formData.difficulty}
                onValueChange={(v) => setFormData({ ...formData, difficulty: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mixed">{t('diff_mixed')}</SelectItem>
                  <SelectItem value="easy">{t('diff_easy')}</SelectItem>
                  <SelectItem value="medium">{t('diff_medium')}</SelectItem>
                  <SelectItem value="hard">{t('diff_hard')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>{t('question_count_label', { count: formData.questionCount })}</Label>
              <input
                type="range"
                min={1}
                max={50}
                value={formData.questionCount}
                onChange={(e) =>
                  setFormData({ ...formData, questionCount: parseInt(e.target.value) })
                }
                className="w-full mt-2"
              />
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>1</span>
                <span>50</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              {t('common_cancel')}
            </Button>
            <Button onClick={generateQuiz}>{t('generate_quiz')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
