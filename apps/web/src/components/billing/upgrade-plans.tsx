'use client';

import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PlanCard } from '@/components/pricing/plan-card';
import { useAuth } from '@/components/providers/AuthProvider';
import { useApiQuery } from '@/hooks/use-api';

interface UpgradePlansProps {
  /** Dashboard audience the catalogue is filtered by (`?for=`). */
  audience: 'student' | 'educator' | 'manager';
  /** Key of the plan the account is already on, if the caller resolved one. */
  currentPlanKey?: string;
  /** Active organization; organization plans are bought for it. */
  orgId?: string;
}

/** Plan grid behind every dashboard's "upgrade" route. */
export function UpgradePlans({ audience, currentPlanKey, orgId }: UpgradePlansProps) {
  const ut = useTranslations('UpgradePage');
  const pt = useTranslations('PricingPage');
  const { user } = useAuth();

  const { data: plans, isLoading } = useApiQuery<PlanInfo[]>({
    queryKey: ['subscription-plans', 'active', audience],
    url: `/api/v1/subscription-plans?for=${audience}`,
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{ut('title')}</h1>
        <p className="text-muted-foreground mt-1">{ut('subtitle')}</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {(plans ?? []).map((plan) => (
            <PlanCard
              key={plan.key}
              plan={plan}
              isCurrentPlan={plan.key === currentPlanKey}
              user={user}
              t={pt}
              accountType={audience}
              orgId={orgId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
