'use client';

import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import { UpgradePlans } from '@/components/billing/upgrade-plans';
import { useAuth } from '@/components/providers/AuthProvider';
import { useApiQuery } from '@/hooks/use-api';

export default function EduUpgradePage() {
  const { user } = useAuth();

  // The badge keeps the effective plan (the seat plan of a seated teacher, #179);
  // the action gating asks the personal plan, which is the one these rows sell.
  const { data: currentPlan } = useApiQuery<PlanInfo>({
    queryKey: ['me', 'plan'],
    url: '/api/v1/me/plan',
    enabled: !!user,
  });
  const { data: personalPlan, isSuccess: personalLoaded } = useApiQuery<PlanInfo>({
    queryKey: ['me', 'personal-plan'],
    url: '/api/v1/me/personal-plan',
    enabled: !!user,
  });
  const hasActivePlan = personalLoaded ? personalPlan.priceMonthly > 0 : null;

  return (
    <UpgradePlans
      scope="personal"
      currentPlanKey={currentPlan?.key}
      hasActivePlan={hasActivePlan}
      billingHref="/edu/billing"
    />
  );
}
