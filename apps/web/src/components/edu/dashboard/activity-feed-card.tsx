'use client';

import type { TeacherFeedItem } from '@studiq/server/models/stats.model';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@studiq/ui';
import { ClipboardCheck, FileCheck2, Flag, History } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { formatRelativeTime } from '@/lib/relative-time';

interface ActivityFeedCardProps {
  items: TeacherFeedItem[] | undefined;
  isLoading: boolean;
}

const ICONS = {
  quiz_completed: ClipboardCheck,
  assignment_submitted: FileCheck2,
  report_opened: Flag,
} as const;

/** Where a feed line leads: the results of an assignment, or the reports inbox. */
function hrefFor(item: TeacherFeedItem): string | null {
  if (item.kind === 'report_opened') return '/edu/reports';
  if (item.kind === 'assignment_submitted' && item.assignmentId) {
    return `/edu/assignments/${item.assignmentId}/results`;
  }
  return null;
}

export function ActivityFeedCard({ items, isLoading }: ActivityFeedCardProps) {
  const t = useTranslations('EduOverviewPage');
  const locale = useLocale();

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <div className="rounded-lg bg-primary/10 p-1.5">
            <History className="h-4 w-4 text-primary" aria-hidden="true" />
          </div>
          {t('feed_title')}
        </CardTitle>
        <CardDescription>{t('feed_desc')}</CardDescription>
      </CardHeader>
      <CardContent className="pb-6">
        {isLoading ? (
          <div className="h-40 animate-pulse rounded-xl bg-muted" />
        ) : !items || items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('feed_empty')}</p>
        ) : (
          <ul className="space-y-1">
            {items.map((item, index) => {
              const Icon = ICONS[item.kind];
              const href = hrefFor(item);
              const name = item.personName ?? t('unknown_person');
              const title = item.title ?? t('untitled');
              const line = (
                <div className="flex items-start gap-3 rounded-lg p-2 hover:bg-muted/60">
                  <Icon
                    className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      {t(`feed_${item.kind}`, { name, title, score: item.scorePct ?? 0 })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatRelativeTime(item.at, locale)}
                    </p>
                  </div>
                  {item.needsGrading && (
                    <Badge variant="secondary" className="shrink-0">
                      {t('feed_needs_grading')}
                    </Badge>
                  )}
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
