'use client';

import { Button, Card, CardContent, CardHeader, CardTitle } from '@studiq/ui';
import { Plus, ScrollText } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { PlanLockedCard } from '@/components/shared/plan-locked-card';
import { useApiQuery } from '@/hooks/use-api';
import { useEntitlement } from '@/hooks/use-entitlement';
import { useEntitlements } from '@/hooks/use-entitlements';
import { formatDateTime } from '@/lib/datetime';
import { quizKeys } from '@/lib/query-keys';
import { EmptyState, ErrorState } from '@/components/shared/empty-state';

interface Quiz {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  quiz_questions: { count: number }[];
}

export function QuizzesClient() {
  const t = useTranslations('EduQuizzesPage');
  const locale = useLocale();

  // The saved-quiz library is the paid `quiz.templates` surface (phase 5d):
  // unentitled, the list and the "New quiz" button are replaced by the plan
  // card; the reads behind them stay open. While the features query is in
  // flight the check is a provisional `false`, so the pending state shares the
  // loading skeleton and an entitled teacher never flashes the locked card.
  const canTemplates = useEntitlement()('quiz.templates');
  const { isPending: entitlementsPending } = useEntitlements();

  const {
    data: quizzes,
    isLoading,
    isError,
    refetch,
  } = useApiQuery<Quiz[]>({
    queryKey: quizKeys.all,
    url: '/api/v1/teacher/quizzes',
    enabled: canTemplates,
  });

  if (isLoading || entitlementsPending) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-32 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        {canTemplates && (
          <Link href="/edu/quizzes/new">
            <Button>
              <Plus className="w-4 h-4 mr-1" /> {t('new_quiz')}
            </Button>
          </Link>
        )}
      </div>

      {!canTemplates ? (
        <PlanLockedCard
          title={t('locked_title')}
          description={t('locked_desc')}
          cta={t('locked_cta')}
        />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : !quizzes || quizzes.length === 0 ? (
        <EmptyState icon={ScrollText} title={t('empty')} description={t('empty_desc')} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {quizzes.map((quiz) => (
            <Link key={quiz.id} href={`/edu/quizzes/${quiz.id}`}>
              <Card className="h-full hover:bg-accent/50 transition-colors cursor-pointer">
                <CardHeader>
                  <CardTitle className="text-base">{quiz.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  {quiz.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                      {quiz.description}
                    </p>
                  )}
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>{t('questions', { count: quiz.quiz_questions[0]?.count ?? 0 })}</span>
                    <span>
                      {t('last_updated', { date: formatDateTime(quiz.created_at, locale) })}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
