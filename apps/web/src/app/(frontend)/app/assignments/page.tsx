'use client';

import { ClipboardCheck } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useApiQuery } from '@/hooks/use-api';
import {
  attemptsLeft,
  hasAttemptsLeft,
  openAttempt,
  type StudentAssignmentAttemptState,
} from '@/lib/assignment-attempts';
import { studentAssignmentKeys } from '@/lib/query-keys';

interface StudentAssignment extends StudentAssignmentAttemptState {
  id: string;
  title: string;
  description: string | null;
  deadline: string | null;
  start_time: string | null;
  time_limit_min: number | null;
  question_count: number;
}

export default function StudentAssignmentsPage() {
  const t = useTranslations('AppAssignmentsPage');
  const locale = useLocale();

  const { data: assignments, isLoading } = useApiQuery<StudentAssignment[]>({
    queryKey: studentAssignmentKeys.all,
    url: '/api/v1/assignments',
  });

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString(locale);
  };

  const now = new Date();
  const isScheduled = (a: StudentAssignment) =>
    hasAttemptsLeft(a) && !!a.start_time && now < new Date(a.start_time);
  const isClosed = (a: StudentAssignment) =>
    hasAttemptsLeft(a) && !isScheduled(a) && !!a.deadline && now > new Date(a.deadline);

  const scheduled = assignments?.filter(isScheduled) ?? [];
  const closed = assignments?.filter(isClosed) ?? [];
  const completed = assignments?.filter((a) => !hasAttemptsLeft(a)) ?? [];
  const pending =
    assignments?.filter((a) => hasAttemptsLeft(a) && !isScheduled(a) && !isClosed(a)) ?? [];

  return (
    <div className="p-6 space-y-8 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      ) : pending.length === 0 &&
        scheduled.length === 0 &&
        closed.length === 0 &&
        completed.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <ClipboardCheck className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold">{t('empty')}</h3>
          <p className="text-sm text-muted-foreground mt-1">{t('empty_desc')}</p>
        </div>
      ) : (
        <>
          {scheduled.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Scheduled ({scheduled.length})
              </h2>
              {scheduled.map((a) => (
                <Link key={a.id} href={`/app/assignments/${a.id}`}>
                  <div className="rounded-lg border p-4 hover:bg-accent/50 transition-colors cursor-pointer space-y-2">
                    <div className="flex items-start justify-between">
                      <h3 className="font-semibold">{a.title}</h3>
                      <span className="text-xs bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 px-2 py-0.5 rounded-full">
                        Scheduled
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Opens: {formatDate(a.start_time)}
                    </p>
                  </div>
                </Link>
              ))}
            </section>
          )}

          {pending.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                {t('pending', { count: pending.length })}
              </h2>
              {pending.map((a) => (
                <Link key={a.id} href={`/app/assignments/${a.id}`}>
                  <div className="rounded-lg border p-4 hover:bg-accent/50 transition-colors cursor-pointer space-y-2">
                    <div className="flex items-start justify-between">
                      <h3 className="font-semibold">{a.title}</h3>
                      <span className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 px-2 py-0.5 rounded-full">
                        {t('questions', { count: a.question_count })}
                      </span>
                    </div>
                    {a.description && (
                      <p className="text-sm text-muted-foreground line-clamp-1">{a.description}</p>
                    )}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      {a.deadline && <span>{t('due', { date: formatDate(a.deadline) })}</span>}
                      {a.time_limit_min && <span>{a.time_limit_min} min</span>}
                      {openAttempt(a) && (
                        <span className="text-amber-600 dark:text-amber-400 font-medium">
                          {t('in_progress')}
                        </span>
                      )}
                      {a.max_attempts > 1 && (
                        <span>
                          {t('attempts_left', {
                            left: attemptsLeft(a),
                            total: a.max_attempts,
                          })}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </section>
          )}

          {closed.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Closed ({closed.length})
              </h2>
              {closed.map((a) => (
                <Link key={a.id} href={`/app/assignments/${a.id}`}>
                  <div className="rounded-lg border p-4 hover:bg-accent/50 transition-colors cursor-pointer space-y-2 opacity-60">
                    <h3 className="font-semibold">{a.title}</h3>
                    <p className="text-xs text-muted-foreground">
                      Closed: {formatDate(a.deadline)}
                    </p>
                  </div>
                </Link>
              ))}
            </section>
          )}

          {completed.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                {t('completed', { count: completed.length })}
              </h2>
              {completed.map((a) => {
                const lastCompleted = a.last_completed_attempt;
                return (
                  <Link key={a.id} href={`/app/assignments/${a.id}`}>
                    <div className="rounded-lg border p-4 hover:bg-accent/50 transition-colors cursor-pointer space-y-2">
                      <div className="flex items-start justify-between">
                        <h3 className="font-semibold">{a.title}</h3>
                        <span className="text-xs text-muted-foreground">
                          {lastCompleted?.score}/
                          {lastCompleted?.total_points || lastCompleted?.total_questions}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span>
                          {t('completed_on', {
                            date: formatDate(lastCompleted?.completed_at ?? null),
                          })}
                        </span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </section>
          )}
        </>
      )}
    </div>
  );
}
