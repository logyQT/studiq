'use client';

import { useTranslations } from 'next-intl';
import { QuizzesTab } from '@/components/stats/quizzes-tab';
import { TopicMasteryCard } from '@/components/stats/topic-mastery-card';

export default function StatsResultsPage() {
  const t = useTranslations('DashboardLayout');

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">{t('stats_results')}</h1>
      <QuizzesTab />
      <TopicMasteryCard />
    </div>
  );
}
