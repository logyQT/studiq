'use client';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Progress,
} from '@studiq/ui';
import { CalendarCheck } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { dueProgress } from '@/lib/due-progress';

interface DueProgressCardProps {
  due: number | undefined;
  reviewed: number | undefined;
  isLoading: boolean;
}

/** Today's reviews: how many are done and how many are still due, as a progress bar. */
export function DueProgressCard({ due, reviewed, isLoading }: DueProgressCardProps) {
  const t = useTranslations('AppDashboard');
  const progress = dueProgress(reviewed ?? 0, due ?? 0);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <div className="rounded-lg bg-violet-500/10 p-1.5">
            <CalendarCheck
              className="h-4 w-4 text-violet-600 dark:text-violet-400"
              aria-hidden="true"
            />
          </div>
          {t('due_title')}
        </CardTitle>
        <CardDescription>{t('due_desc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pb-6">
        {isLoading ? (
          <div className="h-16 animate-pulse rounded-xl bg-muted" />
        ) : progress.total === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{t('due_none')}</p>
        ) : (
          <>
            <div className="flex items-end justify-between">
              <p className="text-sm">
                {progress.remaining === 0
                  ? t('due_all_done')
                  : t('due_remaining', { count: progress.remaining })}
              </p>
              <p className="text-xs tabular-nums text-muted-foreground">
                {t('due_progress', { done: progress.done, total: progress.total })}
              </p>
            </div>
            <Progress value={progress.percent} aria-label={t('due_title')} />
            {progress.remaining > 0 && (
              <Button asChild size="sm" className="w-full">
                <Link href="/app/study">{t('due_cta')}</Link>
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
