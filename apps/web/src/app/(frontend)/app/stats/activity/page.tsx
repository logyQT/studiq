'use client';

import { useTranslations } from 'next-intl';
import { OverviewTab } from '@/components/stats/overview-tab';
import { StudyTimeCard } from '@/components/stats/study-time-card';

export default function StatsActivityPage() {
  const t = useTranslations('DashboardLayout');

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">{t('stats_activity')}</h1>
      <OverviewTab />
      <StudyTimeCard />
    </div>
  );
}
