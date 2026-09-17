'use client';

import { useTranslations } from 'next-intl';
import { FlashcardsTab } from '@/components/stats/flashcards-tab';

export default function StatsContentPage() {
  const t = useTranslations('DashboardLayout');

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">{t('stats_data')}</h1>
      <FlashcardsTab />
    </div>
  );
}
