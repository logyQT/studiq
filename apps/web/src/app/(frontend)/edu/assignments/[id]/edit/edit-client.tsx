'use client';

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Switch,
  Textarea,
} from '@studiq/ui';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useApiMutation, useApiQuery } from '@/hooks/use-api';
import { dbToDatetimeLocal } from '@/lib/datetime';
import { assignmentKeys } from '@/lib/query-keys';

interface AssignmentDetail {
  id: string;
  title: string;
  description: string | null;
  deadline: string | null;
  time_limit_min: number | null;
  shuffle_questions: boolean;
  shuffle_answers: boolean;
  show_results: boolean;
  max_attempts: number;
  passing_score: number | null;
}

export default function EditAssignmentClient() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('EduAssignmentEditPage');

  const { data: assignment, isLoading } = useApiQuery<AssignmentDetail>({
    queryKey: assignmentKeys.detail(id),
    url: `/api/v1/teacher/assignments/${id}`,
  });

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [deadline, setDeadline] = useState('');
  const [timeLimitMin, setTimeLimitMin] = useState('');
  const [shuffleQuestions, setShuffleQuestions] = useState(true);
  const [shuffleAnswers, setShuffleAnswers] = useState(true);
  const [showResults, setShowResults] = useState(false);
  const [maxAttempts, setMaxAttempts] = useState('1');
  const [passingScore, setPassingScore] = useState('');

  useEffect(() => {
    if (assignment) {
      setTitle(assignment.title);
      setDescription(assignment.description ?? '');
      setDeadline(assignment.deadline ? dbToDatetimeLocal(assignment.deadline) : '');
      setTimeLimitMin(assignment.time_limit_min?.toString() ?? '');
      setShuffleQuestions(assignment.shuffle_questions);
      setShuffleAnswers(assignment.shuffle_answers);
      setShowResults(assignment.show_results);
      setMaxAttempts(assignment.max_attempts.toString());
      setPassingScore(assignment.passing_score?.toString() ?? '');
    }
  }, [assignment]);

  const updateMutation = useApiMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch(`/api/v1/teacher/assignments/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      return json.data;
    },
    invalidateKeys: [assignmentKeys.detail(id), assignmentKeys.all],
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateMutation.mutateAsync({
      title,
      description: description || undefined,
      deadline: deadline ? new Date(deadline).toISOString() : undefined,
      timeLimitMin: timeLimitMin ? parseInt(timeLimitMin, 10) : undefined,
      shuffleQuestions,
      shuffleAnswers,
      showResults,
      maxAttempts: parseInt(maxAttempts, 10),
      passingScore: passingScore ? parseInt(passingScore, 10) : undefined,
    });
    router.push(`/edu/assignments/${id}`);
  };

  if (isLoading) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-4">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('basic_info')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">{t('title_field')}</Label>
              <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">{t('description')}</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('timing_limits')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="deadline">{t('deadline')}</Label>
              <Input
                id="deadline"
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="timeLimit">{t('time_limit_min')}</Label>
              <Input
                id="timeLimit"
                type="number"
                min={1}
                max={300}
                value={timeLimitMin}
                onChange={(e) => setTimeLimitMin(e.target.value)}
                placeholder={t('no_limit')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxAttempts">{t('max_attempts')}</Label>
              <Input
                id="maxAttempts"
                type="number"
                min={1}
                max={10}
                value={maxAttempts}
                onChange={(e) => setMaxAttempts(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="passingScore">{t('passing_score')}</Label>
              <Input
                id="passingScore"
                type="number"
                min={0}
                max={100}
                value={passingScore}
                onChange={(e) => setPassingScore(e.target.value)}
                placeholder={t('no_threshold')}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('settings')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>{t('shuffle_questions')}</Label>
                <p className="text-xs text-muted-foreground">{t('shuffle_questions_desc')}</p>
              </div>
              <Switch checked={shuffleQuestions} onCheckedChange={setShuffleQuestions} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>{t('shuffle_answers')}</Label>
                <p className="text-xs text-muted-foreground">{t('shuffle_answers_desc')}</p>
              </div>
              <Switch checked={shuffleAnswers} onCheckedChange={setShuffleAnswers} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>{t('show_results')}</Label>
                <p className="text-xs text-muted-foreground">{t('show_results_desc')}</p>
              </div>
              <Switch checked={showResults} onCheckedChange={setShowResults} />
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-3 justify-end">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            {t('cancel')}
          </Button>
          <Button type="submit" disabled={!title || updateMutation.isPending}>
            {updateMutation.isPending ? t('saving') : t('save_changes')}
          </Button>
        </div>
      </form>
    </div>
  );
}
