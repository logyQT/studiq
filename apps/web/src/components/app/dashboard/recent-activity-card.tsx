'use client';

import type { StudentActivityItem } from '@studiq/server/models/student-overview.model';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@studiq/ui';
import { ClipboardCheck, FileCheck2, History, Layers } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { CardError } from '@/components/app/dashboard/card-error';
import { formatRelativeTime } from '@/lib/relative-time';

interface RecentActivityCardProps {
  items: StudentActivityItem[] | undefined;
  isLoading: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

const ICONS = {
  flashcards_studied: Layers,
  quiz_completed: ClipboardCheck,
  assignment_submitted: FileCheck2,
} as const;

/** Where a line leads: the review of a finished quiz; submitted assignments keep their own page. */
function hrefFor(item: StudentActivityItem): string | null {
  if (item.kind === 'quiz_completed' && item.attemptId) {
    return `/app/study/session/quiz/${item.attemptId}/review`;
  }
  return null;
}

export function RecentActivityCard({
  items,
  isLoading,
  isError,
  onRetry,
}: RecentActivityCardProps) {
  const t = useTranslations('AppDashboard');
  const locale = useLocale();

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <div className="rounded-lg bg-primary/10 p-1.5">
            <History className="h-4 w-4 text-primary" aria-hidden="true" />
          </div>
          {t('activity_title')}
        </CardTitle>
        <CardDescription>{t('activity_desc')}</CardDescription>
      </CardHeader>
      <CardContent className="pb-6">
        {isLoading ? (
          <div className="h-32 animate-pulse rounded-xl bg-muted" />
        ) : isError && onRetry ? (
          <CardError onRetry={onRetry} />
        ) : !items || items.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{t('activity_empty')}</p>
        ) : (
          <ul className="space-y-1">
            {items.map((item, index) => {
              const Icon = ICONS[item.kind];
              const href = hrefFor(item);
              const title = item.title ?? t('untitled_quiz');
              const text =
                item.kind === 'flashcards_studied'
                  ? t('activity_flashcards_studied', { count: item.cardsStudied ?? 0 })
                  : item.scorePct === null
                    ? t(`activity_${item.kind}_no_score`, { title })
                    : t(`activity_${item.kind}`, { title, score: item.scorePct });
              const line = (
                <div className="flex items-start gap-3 rounded-lg p-2 hover:bg-muted/60">
                  <Icon
                    className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{text}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatRelativeTime(item.at, locale)}
                    </p>
                  </div>
                </div>
              );
              return (
                <li key={`${item.kind}-${item.at}-${index}`}>
                  {href ? (
                    <Link href={href} className="block">
                      {line}
                    </Link>
                  ) : (
                    line
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
