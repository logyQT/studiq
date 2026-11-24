'use client';

import { Skeleton } from '@studiq/ui';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { PlanLockedCard } from '@/components/shared/plan-locked-card';
import type { useStudentInsightsGate } from '@/hooks/use-student-insights';

/**
 * The body of a `stats.insights`-gated card (phase 5d): while the features
 * query is pending (or the gated query itself is loading) the skeleton shows;
 * unentitled, the plan card replaces the body; entitled, the children render.
 * The query behind the card is already disabled while unentitled, so a free
 * student never fires a 403 on every visit.
 */
export function InsightsGate({
  gate,
  skeleton,
  children,
}: {
  gate: ReturnType<typeof useStudentInsightsGate>;
  /** Skeleton class of the card's loading state, e.g. `h-56 w-full`. */
  skeleton: string;
  children: ReactNode;
}) {
  const t = useTranslations('StudentInsights');

  if (gate.entitlementsPending || gate.isLoading) {
    return <Skeleton className={skeleton} />;
  }
  if (!gate.canInsights) {
    return (
      <PlanLockedCard
        title={t('locked_title')}
        description={t('locked_desc')}
        cta={t('locked_cta')}
      />
    );
  }
  return children;
}
