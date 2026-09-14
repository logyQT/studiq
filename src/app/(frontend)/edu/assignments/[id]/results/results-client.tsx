'use client';

import { ArrowLeft, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useApiQuery } from '@/hooks/use-api';
import { assignmentKeys } from '@/lib/query-keys';

interface Attempt {
  id: string;
  user_id: string;
  score: number;
  total_questions: number;
  completed_at: string | null;
  started_at: string;
  graded_at: string | null;
  user: {
    id: string;
    email: string;
    full_name: string;
  };
}

export default function ResultsClient() {
  const { id } = useParams<{ id: string }>();
  const locale = useLocale();
  const t = useTranslations('EduAssignmentResultsPage');

  const { data: results, isLoading } = useApiQuery<Attempt[]>({
    queryKey: assignmentKeys.results(id),
    url: `/api/v1/teacher/assignments/${id}/results`,
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href={`/edu/assignments/${id}`} className="hover:text-foreground">
          <ArrowLeft className="w-4 h-4 inline mr-1" />
          {t('back')}
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b">
              <th className="text-left p-3 font-medium">{t('student')}</th>
              <th className="text-left p-3 font-medium">{t('email')}</th>
              <th className="text-center p-3 font-medium">{t('score')}</th>
              <th className="text-center p-3 font-medium">{t('status')}</th>
              <th className="text-center p-3 font-medium">{t('completed_at')}</th>
              <th className="text-right p-3 font-medium">{t('actions')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b animate-pulse">
                  <td className="p-3">
                    <div className="h-4 w-32 bg-muted rounded" />
                  </td>
                  <td className="p-3">
                    <div className="h-4 w-40 bg-muted rounded" />
                  </td>
                  <td className="p-3">
                    <div className="h-4 w-12 bg-muted rounded mx-auto" />
                  </td>
                  <td className="p-3">
                    <div className="h-4 w-16 bg-muted rounded mx-auto" />
                  </td>
                  <td className="p-3">
                    <div className="h-4 w-20 bg-muted rounded mx-auto" />
                  </td>
                  <td className="p-3">
                    <div className="h-4 w-8 bg-muted rounded ml-auto" />
                  </td>
                </tr>
              ))
            ) : results?.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted-foreground">
                  {t('no_results')}
                </td>
              </tr>
            ) : (
              results?.map((attempt) => (
                <tr key={attempt.id} className="border-b hover:bg-muted/30">
                  <td className="p-3 font-medium">{attempt.user?.full_name ?? t('unknown')}</td>
                  <td className="p-3 text-muted-foreground">{attempt.user?.email}</td>
                  <td className="p-3 text-center">
                    {attempt.completed_at ? `${attempt.score}/${attempt.total_questions}` : '-'}
                  </td>
                  <td className="p-3 text-center">
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        attempt.graded_at
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : attempt.completed_at
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                            : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {attempt.graded_at
                        ? t('graded')
                        : attempt.completed_at
                          ? t('submitted')
                          : t('in_progress')}
                    </span>
                  </td>
                  <td className="p-3 text-center text-muted-foreground">
                    {attempt.completed_at
                      ? new Date(attempt.completed_at).toLocaleDateString(locale)
                      : '-'}
                  </td>
                  <td className="p-3 text-right">
                    <Link
                      href={`/edu/assignments/${id}/results/${attempt.user_id}`}
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      {t('grade')} <ExternalLink className="w-3 h-3" />
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
