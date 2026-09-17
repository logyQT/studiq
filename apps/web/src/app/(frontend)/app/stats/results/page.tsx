'use client';

import { useTranslations } from 'next-intl';
import { QuizzesTab } from '@/components/stats/quizzes-tab';

export default function StatsResultsPage() {
  const t = useTranslations('DashboardLayout');

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">{t('stats_results')}</h1>
      <QuizzesTab />
    </div>
  );
}
