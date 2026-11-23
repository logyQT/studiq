'use client';

import type { StateBreakdown } from '@studiq/server/models/flashcard-practice.model';
import type {
  ActivityResponse,
  WeakItem,
  WeakPointsResponse,
} from '@studiq/server/models/stats.model';
import { Card, CardContent, CardHeader, CardTitle, Skeleton, StatCard } from '@studiq/ui';
import { AlertTriangle, Brain, CalendarDays, CheckCircle2, TrendingUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { DailyActivityChart } from '@/components/stats/daily-activity-chart';
import { StateBreakdownChart } from '@/components/stats/state-breakdown-chart';
import { WeakPointsList } from '@/components/stats/weak-points-list';
import { PlanLockedCard } from '@/components/shared/plan-locked-card';
import { useApiQuery } from '@/hooks/use-api';
import { useFeature } from '@/hooks/use-feature';
import { useFeatures } from '@/hooks/use-features';
import { flashcardKeys } from '@/lib/query-keys';
import { summarizeWeeklyActivity } from '@/lib/stats';

/**
 * One weak-points card. The read is a diagnostic (phase 5d): gated on
 * `stats.insights` and disabled for a free student so no 403 fires on every
 * visit; the descriptive cards above stay open.
 */
function WeakPointsCard({
  title,
  items,
  type,
  canInsights,
  featuresPending,
  weakLoading,
}: {
  title: string;
  items: WeakItem[];
  type: 'deck' | 'topic';
  canInsights: boolean;
  featuresPending: boolean;
  weakLoading: boolean;
}) {
  const t = useTranslations('AppStatsPage');
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {weakLoading || featuresPending ? (
          <Skeleton className="h-32 w-full" />
        ) : !canInsights ? (
          <PlanLockedCard
            title={t('locked_title')}
            description={t('locked_desc')}
            cta={t('locked_cta')}
          />
        ) : (
          <WeakPointsList items={items} type={type} />
        )}
      </CardContent>
    </Card>
  );
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

  // The weak-points read is a diagnostic (phase 5d): gated on `stats.insights`
  // and disabled for a free student so no 403 fires on every visit; the
  // descriptive cards above stay open.
  const canInsights = useFeature()('stats.insights');
  const { isPending: featuresPending } = useFeatures();

  const { data: weakPoints, isLoading: weakLoading } = useApiQuery<WeakPointsResponse>({
    queryKey: [...flashcardKeys.all, 'stats', 'weak-points'],
    url: '/api/v1/stats/weak-points',
    enabled: canInsights,
  });

  // „Powtórki w tym tygodniu” and „Poprawne” are a fixed last-7-days metric; the range
  // selector only recalcs the chart, so both cards read the same weekly window (#383).
  const weekly = summarizeWeeklyActivity(activity?.items);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          title={t('reviews_this_week')}
          value={activityLoading ? '...' : weekly.reviews}
          icon={CalendarDays}
          variant="blue"
        />
        <StatCard
          title={t('correct')}
          value={activityLoading ? '...' : weekly.correct}
          icon={CheckCircle2}
          variant="emerald"
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
              <div className="min-h-[260px]">
                <StateBreakdownChart states={states} />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <WeakPointsCard
          title={t('weak_decks')}
          items={weakPoints?.weakDecks ?? []}
          type="deck"
          canInsights={canInsights}
          featuresPending={featuresPending}
          weakLoading={weakLoading}
        />
        <WeakPointsCard
          title={t('weak_topics')}
          items={weakPoints?.weakTopics ?? []}
          type="topic"
          canInsights={canInsights}
          featuresPending={featuresPending}
          weakLoading={weakLoading}
        />
      </div>
    </div>
  );
}
