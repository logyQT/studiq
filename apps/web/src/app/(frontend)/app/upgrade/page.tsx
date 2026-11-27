'use client';

import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import { UpgradePlans } from '@/components/billing/upgrade-plans';
import { useAuth } from '@/components/providers/AuthProvider';
import { useApiQuery } from '@/hooks/use-api';
import { useManagerRedirect } from '@/hooks/use-manager-redirect';

export default function AppUpgradePage() {
  const isManager = useManagerRedirect('/manage');
  const { user } = useAuth();

  const { data: currentPlan, isSuccess: planLoaded } = useApiQuery<PlanInfo>({
    queryKey: ['me', 'personal-plan'],
    url: '/api/v1/me/personal-plan',
    enabled: !!user && !isManager,
  });
  const hasActivePlan = planLoaded ? currentPlan.priceMonthly > 0 : null;

  if (isManager) return null;

  return (
    <UpgradePlans
      scope="personal"
      currentPlanKey={currentPlan?.key}
      hasActivePlan={hasActivePlan}
      billingHref="/app/billing"
    />
  );
}
