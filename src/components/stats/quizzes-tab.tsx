'use client';

import { useTranslations } from 'next-intl';
import { Empty, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { ClipboardList } from 'lucide-react';

export function QuizzesTab() {
  const t = useTranslations('AppStatsPage');

  return (
    <Empty>
      <EmptyMedia>
        <ClipboardList className="h-10 w-10 text-muted-foreground" />
      </EmptyMedia>
      <EmptyTitle>{t('quizzes_coming_soon')}</EmptyTitle>
    </Empty>
  );
}
