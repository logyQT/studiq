'use client';

import { ArrowLeft, Clock, FileQuestion, Timer } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useApiMutation, useApiQuery } from '@/hooks/use-api';
import { studentAssignmentKeys } from '@/lib/query-keys';

interface AssignmentDetail {
  id: string;
  title: string;
  description: string | null;
  deadline: string | null;
  time_limit_min: number | null;
  max_attempts: number;
  question_count: number;
  shuffle_questions: boolean;
  attempt: {
    id: string;
    score: number;
    total_questions: number;
    completed_at: string | null;
    started_at: string;
  } | null;
}

export default function StudentAssignmentDetailPage() {
  const t = useTranslations('AppAssignmentDetailPage');
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const locale = useLocale();

  const { data: assignment, isLoading } = useApiQuery<AssignmentDetail>({
    queryKey: studentAssignmentKeys.detail(id),
    url: `/api/v1/assignments/${id}`,
  });

  const startMutation = useApiMutation<unknown, void>({
    mutationFn: async () => {
      const res = await fetch(`/api/v1/assignments/${id}/start`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      return json.data;
    },
  });

  const handleStart = async () => {
    const data = await startMutation.mutateAsync(undefined);
    router.push(`/app/assignments/${id}/take?attemptId=${(data as { id: string }).id}`);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString(locale);
  };

  if (isLoading) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-4">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="h-32 bg-muted animate-pulse rounded-lg" />
      </div>
    );
  }

  if (!assignment) {
    return <div className="p-6 text-center text-muted-foreground">{t('not_found')}</div>;
  }

  const isCompleted = assignment.attempt?.completed_at;
  const isInProgress = assignment.attempt && !isCompleted;

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/app/assignments" className="hover:text-foreground">
          <ArrowLeft className="w-4 h-4 inline mr-1" />
          {t('back')}
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{assignment.title}</h1>
        {assignment.description && (
          <p className="text-sm text-muted-foreground mt-1">{assignment.description}</p>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
              <FileQuestion className="w-3 h-3" /> {t('questions')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{assignment.question_count}</p>
          </CardContent>
        </Card>
        {assignment.time_limit_min && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                <Timer className="w-3 h-3" /> {t('time_limit')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {t('minutes', { count: assignment.time_limit_min })}
              </p>
            </CardContent>
          </Card>
        )}
        {assignment.deadline && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" /> {t('deadline')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{formatDate(assignment.deadline)}</p>
            </CardContent>
          </Card>
        )}
      </div>

      {isCompleted && assignment.attempt && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('completed')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-lg font-bold">
              {t('score', {
                earned: assignment.attempt.score,
                total: assignment.attempt.total_questions,
              })}
            </p>
            <Link href={`/app/assignments/${id}/review`}>
              <Button variant="outline">{t('view_review')}</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-3">
        {isInProgress && (
          <Button onClick={handleStart} disabled={startMutation.isPending}>
            {startMutation.isPending ? t('loading') : t('continue')}
          </Button>
        )}
        {!assignment.attempt && (
          <Button onClick={handleStart} disabled={startMutation.isPending}>
            {startMutation.isPending ? t('starting') : t('start')}
          </Button>
        )}
      </div>
    </div>
  );
}
