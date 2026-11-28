'use client';

import { ArrowLeft, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  NotStartedStudents,
  type NotStartedStudentRow,
} from '@/components/assignments/not-started-students';
import { useApiQuery } from '@/hooks/use-api';
import { useBreadcrumbLabel } from '@/hooks/use-breadcrumbs';
import { assignmentKeys } from '@/lib/query-keys';

/** R9: counts only, taught items labelled, cells under the threshold suppressed. */
interface FairnessItem {
  questionId: string;
  taughtItem: boolean;
  served: number | null;
  correct: number | null;
  ungraded: number | null;
}

interface Fairness {
  respondents: number;
  minRespondents: number;
  items: FairnessItem[];
}

interface Attempt {
  id: string;
  user_id: string;
  score: number;
  total_questions: number;
  total_points: number | null;
  completed_at: string | null;
  started_at: string;
  /** Derived from the served items (#1069): nothing left for a teacher to grade. */
  graded: boolean;
  user: {
    id: string;
    email: string;
    full_name: string | null;
  } | null;
}

export default function ResultsClient() {
  const { id } = useParams<{ id: string }>();
  const locale = useLocale();
  const t = useTranslations('EduAssignmentResultsPage');

  const { data: results, isLoading } = useApiQuery<{
    attempts: Attempt[];
    fairness: Fairness;
    /** Optional on the wire: a missing list hides the section instead of breaking the page. */
    /** `null` for a run that expects nobody (draft, cancelled): the section is not shown. */
    notStarted?: NotStartedStudentRow[] | null;
    targeted_count?: number;
    run_closed?: boolean;
  }>({
    queryKey: assignmentKeys.results(id),
    url: `/api/v1/teacher/assignments/${id}/results`,
    // Students start and submit while the teacher is elsewhere, and nothing here invalidates
    // the list for that. So every visit, and a return to the window, reads it again (#1340).
    staleTime: 0,
  });

  // Same query key as the detail page, so in-app navigation is a cache hit.
  const { data: assignment } = useApiQuery<{
    title: string;
    assignment_questions?: Array<{ question_id: string; question: { content: string } | null }>;
  }>({
    queryKey: assignmentKeys.detail(id),
    url: `/api/v1/teacher/assignments/${id}`,
  });

  const fairness = results?.fairness;

  const itemLabel = (questionId: string) =>
    assignment?.assignment_questions?.find((link) => link.question_id === questionId)?.question
      ?.content ?? t('unknown');

  // The assignment title is the breadcrumb label; the raw UUID must never render.
  useBreadcrumbLabel(id, assignment?.title);

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
                  <td className="p-3" aria-hidden="true">
                    <div className="h-4 w-32 bg-muted rounded" />
                  </td>
                  <td className="p-3" aria-hidden="true">
                    <div className="h-4 w-40 bg-muted rounded" />
                  </td>
                  <td className="p-3" aria-hidden="true">
                    <div className="h-4 w-12 bg-muted rounded mx-auto" />
                  </td>
                  <td className="p-3" aria-hidden="true">
                    <div className="h-4 w-16 bg-muted rounded mx-auto" />
                  </td>
                  <td className="p-3" aria-hidden="true">
                    <div className="h-4 w-20 bg-muted rounded mx-auto" />
                  </td>
                  <td className="p-3" aria-hidden="true">
                    <div className="h-4 w-8 bg-muted rounded ml-auto" />
                  </td>
                </tr>
              ))
            ) : results?.attempts.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted-foreground">
                  {t('no_results')}
                </td>
              </tr>
            ) : (
              results?.attempts.map((attempt) => (
                <tr key={attempt.id} className="border-b hover:bg-muted/30">
                  <td className="p-3 font-medium">{attempt.user?.full_name ?? t('unknown')}</td>
                  <td className="p-3 text-muted-foreground">{attempt.user?.email}</td>
                  <td className="p-3 text-center">
                    {attempt.completed_at
                      ? `${attempt.score}/${attempt.total_points || attempt.total_questions}`
                      : '-'}
                  </td>
                  <td className="p-3 text-center">
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        attempt.graded
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : attempt.completed_at
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                            : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {attempt.graded
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
                      href={`/edu/assignments/${id}/results/${attempt.id}`}
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

      {results?.notStarted && (
        <NotStartedStudents
          students={results.notStarted}
          targetedCount={results.targeted_count ?? 0}
          closed={results.run_closed ?? false}
        />
      )}

      {fairness && fairness.items.length > 0 && (
        <div className="space-y-2">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">{t('fairness_title')}</h2>
            <p className="text-sm text-muted-foreground">
              {t('fairness_hint', { min: fairness.minRespondents })}
            </p>
          </div>
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="text-left p-3 font-medium">{t('item')}</th>
                  <th className="text-center p-3 font-medium">{t('served')}</th>
                  <th className="text-center p-3 font-medium">{t('correct')}</th>
                  <th className="text-center p-3 font-medium">{t('ungraded')}</th>
                </tr>
              </thead>
              <tbody>
                {fairness.items.map((item) => (
                  <tr key={item.questionId} className="border-b">
                    <td className="p-3">{itemLabel(item.questionId)}</td>
                    {item.taughtItem ? (
                      <td colSpan={3} className="p-3 text-center text-muted-foreground">
                        {t('taught_excluded')}
                      </td>
                    ) : item.served === null ? (
                      <td colSpan={3} className="p-3 text-center text-muted-foreground">
                        {t('suppressed')}
                      </td>
                    ) : (
                      <>
                        <td className="p-3 text-center">{item.served}</td>
                        <td className="p-3 text-center">{item.correct}</td>
                        <td className="p-3 text-center">{item.ungraded}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
