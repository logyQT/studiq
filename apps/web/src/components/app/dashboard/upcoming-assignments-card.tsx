'use client';

import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@studiq/ui';
import { ClipboardCheck } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { useApiQuery } from '@/hooks/use-api';
import type { StudentAssignmentAttemptState } from '@/lib/assignment-attempts';
import { formatDateTime } from '@/lib/datetime';
import { studentAssignmentKeys } from '@/lib/query-keys';
import { upcomingAssignments } from '@/lib/upcoming-assignments';

interface StudentAssignment extends StudentAssignmentAttemptState {
  id: string;
  title: string;
  start_time: string | null;
  deadline: string | null;
}

/** Teacher assignments the student can still do, soonest deadline first. */
export function UpcomingAssignmentsCard() {
  const t = useTranslations('AppDashboard');
  const locale = useLocale();

  // Same query as the assignments page, so the list is shared and kept in sync.
  const { data, isLoading } = useApiQuery<StudentAssignment[]>({
    queryKey: studentAssignmentKeys.all,
    url: '/api/v1/assignments',
    staleTime: 60_000,
  });
  const upcoming = useMemo(() => upcomingAssignments(data ?? [], new Date()), [data]);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <div className="rounded-lg bg-amber-500/10 p-1.5">
            <ClipboardCheck
              className="h-4 w-4 text-amber-600 dark:text-amber-400"
              aria-hidden="true"
            />
          </div>
          {t('upcoming_title')}
        </CardTitle>
        <CardDescription>{t('upcoming_desc')}</CardDescription>
      </CardHeader>
      <CardContent className="pb-6">
        {isLoading ? (
          <div className="h-24 animate-pulse rounded-xl bg-muted" />
        ) : upcoming.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{t('upcoming_empty')}</p>
        ) : (
          <ul className="space-y-1">
            {upcoming.map((assignment) => (
              <li key={assignment.id}>
                <Link
                  href={`/app/assignments/${assignment.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg p-2 hover:bg-muted/60"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{assignment.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {assignment.deadline
                        ? t('upcoming_due', { date: formatDateTime(assignment.deadline, locale) })
                        : t('upcoming_no_deadline')}
                    </p>
                  </div>
                  {assignment.inProgress && (
                    <Badge variant="secondary" className="shrink-0">
                      {t('upcoming_in_progress')}
                    </Badge>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
