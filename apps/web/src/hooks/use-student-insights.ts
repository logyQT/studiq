'use client';

import type { StudentInsights } from '@studiq/server/models/student-insights.model';
import { useApiQuery } from '@/hooks/use-api';
import { useFeature } from '@/hooks/use-feature';
import { useFeatures } from '@/hooks/use-features';
import { studentStatsKeys } from '@/lib/query-keys';

/**
 * The `stats.insights`-gated student insights query (phase 5d): study time,
 * topic mastery and retention of the signed-in student over the last `days`
 * days. The read is disabled while the entitlement is missing, so a free
 * student never fires a 403 on every visit; the pending features query is
 * exposed too, so a gated card can share its loading skeleton instead of
 * flashing the plan card at an entitled student. One hook, so every gated
 * card reads the same facts.
 */
export function useStudentInsightsGate(days: number) {
  const canInsights = useFeature()('stats.insights');
  const { isPending: featuresPending } = useFeatures();
  const query = useApiQuery<StudentInsights>({
    queryKey: studentStatsKeys.insights(days),
    url: `/api/v1/stats/student/insights?days=${days}`,
    // Reviews and quizzes change these numbers all the time; look again after a minute.
    staleTime: 60_000,
    enabled: canInsights,
  });
  return { ...query, canInsights, featuresPending };
}
