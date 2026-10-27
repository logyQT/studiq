'use client';

import type { ProblematicQuestionStats } from '@studiq/server/models/stats.model';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@studiq/ui';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

const SHOWN = 5;

interface ProblemQuestionsCardProps {
  questions: ProblematicQuestionStats[] | undefined;
  isLoading: boolean;
}

/** Questions most students get wrong; the full list lives on the results page. */
export function ProblemQuestionsCard({ questions, isLoading }: ProblemQuestionsCardProps) {
  const t = useTranslations('EduOverviewPage');
  const shown = (questions ?? []).slice(0, SHOWN);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <div className="rounded-lg bg-amber-500/10 p-1.5">
            <AlertTriangle
              className="h-4 w-4 text-amber-600 dark:text-amber-400"
              aria-hidden="true"
            />
          </div>
          {t('problem_title')}
        </CardTitle>
        <CardDescription>{t('problem_desc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pb-6">
        {isLoading ? (
          <div className="h-24 animate-pulse rounded-xl bg-muted" />
        ) : shown.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{t('problem_empty')}</p>
        ) : (
          <ul className="space-y-2">
            {shown.map((question) => (
              <li
                key={question.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-transparent p-3 hover:border-border/60 hover:bg-muted/60"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{question.content}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('problem_answers', { count: question.totalAnswers })}
                  </p>
                </div>
                <Badge variant="destructive" className="shrink-0 tabular-nums">
                  {Math.round(question.correctRate * 100)}%
                </Badge>
              </li>
            ))}
          </ul>
        )}
        <Link
          href="/edu/stats/results"
          className="flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          {t('view_all')}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </CardContent>
    </Card>
  );
}
