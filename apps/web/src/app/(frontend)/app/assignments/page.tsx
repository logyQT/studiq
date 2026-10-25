'use client';

import { ClipboardCheck } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useApiQuery } from '@/hooks/use-api';
import {
  attemptsLeft,
  groupStudentAssignments,
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
  total_points: number;
  show_results: boolean;
}

function formatDate(dateStr: string | null, locale: string) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString(locale);
}

function AssignmentCard({ assignment }: { assignment: StudentAssignment }) {
  const t = useTranslations('AppAssignmentsPage');
  const locale = useLocale();

  return (
    <Link href={`/app/assignments/${assignment.id}`}>
      <div className="rounded-lg border p-4 hover:bg-accent/50 transition-colors cursor-pointer space-y-2">
        <div className="flex items-start justify-between">
          <h3 className="font-semibold">{assignment.title}</h3>
          <span className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 px-2 py-0.5 rounded-full">
            {t('questions', { count: assignment.question_count })} ·{' '}
            {t('points', { count: assignment.total_points })}
          </span>
        </div>
        {assignment.description && (
          <p className="text-sm text-muted-foreground line-clamp-1">{assignment.description}</p>
        )}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {assignment.deadline && (
            <span>{t('due', { date: formatDate(assignment.deadline, locale) })}</span>
          )}
          {assignment.time_limit_min && <span>{assignment.time_limit_min} min</span>}
          {assignment.max_attempts > 1 && (
            <span>
              {t('attempts_left', {
                left: attemptsLeft(assignment),
                total: assignment.max_attempts,
              })}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

export default function StudentAssignmentsPage() {
  const t = useTranslations('AppAssignmentsPage');
  const locale = useLocale();

  const { data: assignments, isLoading } = useApiQuery<StudentAssignment[]>({
    queryKey: studentAssignmentKeys.all,
    url: '/api/v1/assignments',
  });

  const { scheduled, pending, inProgress, closed, completed } = groupStudentAssignments(
    assignments ?? [],
    new Date(),
  );
  const isEmpty = (assignments?.length ?? 0) === 0;

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
      ) : isEmpty ? (
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
                {t('scheduled', { count: scheduled.length })}
              </h2>
              {scheduled.map((a) => (
                <Link key={a.id} href={`/app/assignments/${a.id}`}>
                  <div className="rounded-lg border p-4 hover:bg-accent/50 transition-colors cursor-pointer space-y-2">
                    <div className="flex items-start justify-between">
                      <h3 className="font-semibold">{a.title}</h3>
                      <span className="text-xs bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 px-2 py-0.5 rounded-full">
                        {t('scheduled_badge')}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t('opens', { date: formatDate(a.start_time, locale) })}
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
                <AssignmentCard key={a.id} assignment={a} />
              ))}
            </section>
          )}

          {inProgress.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                {t('in_progress')}
              </h2>
              {inProgress.map((a) => (
                <AssignmentCard key={a.id} assignment={a} />
              ))}
            </section>
          )}

          {closed.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                {t('closed', { count: closed.length })}
              </h2>
              {closed.map((a) => (
                <Link key={a.id} href={`/app/assignments/${a.id}`}>
                  <div className="rounded-lg border p-4 hover:bg-accent/50 transition-colors cursor-pointer space-y-2 opacity-60">
                    <h3 className="font-semibold">{a.title}</h3>
                    <p className="text-xs text-muted-foreground">
                      {t('closed_on', { date: formatDate(a.deadline, locale) })}
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
                          {a.show_results && lastCompleted ? (
                            <>
                              {lastCompleted.score}/
                              {lastCompleted.total_points || lastCompleted.total_questions}
                            </>
                          ) : (
                            t('results_hidden')
                          )}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span>
                          {t('completed_on', {
                            date: formatDate(lastCompleted?.completed_at ?? null, locale),
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
