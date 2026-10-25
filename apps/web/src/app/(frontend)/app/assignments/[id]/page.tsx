'use client';

import { Button, Card, CardContent, CardHeader, CardTitle } from '@studiq/ui';
import { ArrowLeft, Award, Clock, FileQuestion, Lock, Timer } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useApiMutation, useApiQuery } from '@/hooks/use-api';
import {
  type AttemptSummary,
  attemptsLeft,
  openAttempt,
  type StudentAssignmentAttemptState,
} from '@/lib/assignment-attempts';
import { timeUntil } from '@/lib/datetime';
import { studentAssignmentKeys } from '@/lib/query-keys';

interface AssignmentDetail extends StudentAssignmentAttemptState {
  id: string;
  title: string;
  description: string | null;
  deadline: string | null;
  start_time: string | null;
  time_limit_min: number | null;
  question_count: number;
  total_points: number;
  shuffle_questions: boolean;
}

export default function StudentAssignmentDetailPage() {
  const t = useTranslations('AppAssignmentDetailPage');
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const locale = useLocale();

  const [countdown, setCountdown] = useState('');

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
    // Starting/resuming changes `attempt`; without this the detail page keeps a
    // stale `attempt: null` and offers „Rozpocznij” after the student quits.
    invalidateKeys: [studentAssignmentKeys.all],
  });

  const handleStart = async () => {
    const data = await startMutation.mutateAsync(undefined);
    const deadline = assignment?.deadline
      ? `&deadline=${encodeURIComponent(assignment.deadline)}`
      : '';
    router.push(`/app/assignments/${id}/take?attemptId=${(data as { id: string }).id}${deadline}`);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString(locale);
  };

  useEffect(() => {
    if (!assignment?.start_time) return;
    const update = () => setCountdown(timeUntil(assignment.start_time!));
    update();
    const interval = setInterval(update, 10000);
    return () => clearInterval(interval);
  }, [assignment?.start_time]);

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

  const running = openAttempt(assignment);
  const lastCompleted: AttemptSummary | null = assignment.last_completed_attempt;
  const left = attemptsLeft(assignment);
  const now = new Date();
  const isPastDeadline = !!assignment.deadline && now > new Date(assignment.deadline);
  const isScheduled = !!assignment.start_time && now < new Date(assignment.start_time);

  const canStart = !running && left > 0 && !isPastDeadline && !isScheduled;

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/app/assignments" className="hover:text-foreground">
          <ArrowLeft className="w-4 h-4 inline mr-1" />
          {t('back')}
        </Link>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{assignment.title}</h1>
          {assignment.description && (
            <p className="text-sm text-muted-foreground mt-1">{assignment.description}</p>
          )}
        </div>
        {isScheduled && (
          <span className="text-xs bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 px-2 py-0.5 rounded-full">
            Scheduled
          </span>
        )}
        {isPastDeadline && (
          <span className="text-xs bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400 px-2 py-0.5 rounded-full">
            Closed
          </span>
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
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
              <Award className="w-3 h-3" /> {t('points')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{assignment.total_points}</p>
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
        {assignment.start_time && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" /> Opens
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{formatDate(assignment.start_time)}</p>
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

      {isScheduled && countdown && (
        <Card className="border-purple-200 dark:border-purple-800">
          <CardContent className="pt-6 text-center">
            <Lock className="w-6 h-6 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Opens in {countdown}</p>
          </CardContent>
        </Card>
      )}

      {isPastDeadline && !running && (
        <Card className="border-gray-200 dark:border-gray-800 opacity-60">
          <CardContent className="pt-6 text-center">
            <p className="text-sm text-muted-foreground">This assignment is closed.</p>
          </CardContent>
        </Card>
      )}

      {lastCompleted && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {left > 0 ? t('last_attempt') : t('completed')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-lg font-bold">
              {t('score', {
                earned: lastCompleted.score,
                total: lastCompleted.total_points || lastCompleted.total_questions,
              })}
            </p>
            <Link href={`/app/assignments/${id}/review?attemptId=${lastCompleted.id}`}>
              <Button variant="outline">{t('view_review')}</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {assignment.max_attempts > 1 && (
        <p className="text-sm text-muted-foreground">
          {left > 0
            ? t('attempts_left', { left, total: assignment.max_attempts })
            : t('attempts_exhausted', { total: assignment.max_attempts })}
        </p>
      )}

      <div className="flex gap-3">
        {running && (
          <Button onClick={handleStart} disabled={startMutation.isPending}>
            {startMutation.isPending ? t('loading') : t('continue')}
          </Button>
        )}
        {canStart && (
          <Button onClick={handleStart} disabled={startMutation.isPending}>
            {startMutation.isPending
              ? t('starting')
              : assignment.attempts_used > 0
                ? t('start_again')
                : t('start')}
          </Button>
        )}
      </div>
    </div>
  );
}
