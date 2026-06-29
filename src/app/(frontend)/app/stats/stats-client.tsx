'use client';

import { useTranslations } from 'next-intl';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BarChart3, ClipboardList, BookOpen } from 'lucide-react';
import { OverviewTab } from '@/components/stats/overview-tab';
import { QuizzesTab } from '@/components/stats/quizzes-tab';
import { FlashcardsTab } from '@/components/stats/flashcards-tab';

export function StatsClient() {
  const t = useTranslations('AppStatsPage');

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>

      <Tabs defaultValue="overview" className="flex flex-col gap-6">
        <TabsList>
          <TabsTrigger value="overview" className="gap-2">
            <BarChart3 className="size-4" /> {t('tab_overview')}
          </TabsTrigger>
          <TabsTrigger value="quizzes" className="gap-2">
            <ClipboardList className="size-4" /> {t('tab_quizzes')}
          </TabsTrigger>
          <TabsTrigger value="flashcards" className="gap-2">
            <BookOpen className="size-4" /> {t('tab_flashcards')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab />
        </TabsContent>

        <TabsContent value="quizzes">
          <QuizzesTab />
        </TabsContent>

        <TabsContent value="flashcards">
          <FlashcardsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
