'use client';

import { AlertTriangle, Brain, CalendarDays, TrendingUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { DailyActivityChart } from '@/components/stats/daily-activity-chart';
import { StateBreakdownChart } from '@/components/stats/state-breakdown-chart';
import { WeakPointsList } from '@/components/stats/weak-points-list';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/stat-card';
import { useApiQuery } from '@/hooks/use-api';
import { flashcardKeys } from '@/lib/query-keys';

interface StateBreakdown {
  totalCards: number;
  neverPracticed: number;
  learning: number;
  review: number;
  relearning: number;
  leeched: number;
}

interface DailyActivityItem {
  date: string;
  reviews_count: number;
  reviews_correct: number;
  quizzes_count: number;
  quizzes_score: number;
  quizzes_total: number;
}

interface ActivityResponse {
  items: DailyActivityItem[];
  dailyReviewGoal: number;
}

interface WeakDeckItem {
  deckId: string;
  name: string;
  accuracy: number;
  totalAttempts: number;
}

interface WeakTopicItem {
  topicId: string;
  name: string;
  accuracy: number;
  totalAttempts: number;
}

interface WeakPointsResponse {
  weakDecks: WeakDeckItem[];
  weakTopics: WeakTopicItem[];
}

export function OverviewTab() {
  const t = useTranslations('AppStatsPage');
  const [range, setRange] = useState('7d');

  const { data: activity, isLoading: activityLoading } = useApiQuery<ActivityResponse>({
    queryKey: [...flashcardKeys.all, 'stats', 'activity', range],
    url: `/api/v1/stats/activity?range=${range}`,
  });

  const { data: states } = useApiQuery<StateBreakdown>({
    queryKey: flashcardKeys.practice.states,
    url: '/api/v1/flashcards/practice/states',
  });

  const { data: weakPoints, isLoading: weakLoading } = useApiQuery<WeakPointsResponse>({
    queryKey: [...flashcardKeys.all, 'stats', 'weak-points'],
    url: '/api/v1/stats/weak-points',
  });

  const reviewsThisWeek = (activity?.items ?? []).reduce((sum, d) => sum + d.reviews_count, 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t('reviews_this_week')}
          value={activityLoading ? '...' : reviewsThisWeek}
          icon={CalendarDays}
          variant="blue"
        />
        <StatCard
          title={t('due_today')}
          value={states?.learning ?? '...'}
          icon={Brain}
          variant="amber"
        />
        <StatCard
          title={t('state_review')}
          value={states?.review ?? '...'}
          icon={TrendingUp}
          variant="emerald"
        />
        <StatCard
          title={t('state_leech')}
          value={states?.leeched ?? '...'}
          icon={AlertTriangle}
          variant="rose"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('daily_activity')}</CardTitle>
          </CardHeader>
          <CardContent>
            {activityLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <div className="min-h-[260px]">
                <DailyActivityChart
                  data={activity?.items ?? []}
                  goal={activity?.dailyReviewGoal ?? 0}
                  range={range}
                  onRangeChange={setRange}
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('state_breakdown')}</CardTitle>
          </CardHeader>
          <CardContent>
            {!states ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <div className="min-h-[260px] flex items-center justify-center">
                <StateBreakdownChart states={states} />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('weak_decks')}</CardTitle>
          </CardHeader>
          <CardContent>
            {weakLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <WeakPointsList items={weakPoints?.weakDecks ?? []} type="deck" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('weak_topics')}</CardTitle>
          </CardHeader>
          <CardContent>
            {weakLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <WeakPointsList items={weakPoints?.weakTopics ?? []} type="topic" />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
