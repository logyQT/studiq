'use client';

import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import { UpgradePlans } from '@/components/billing/upgrade-plans';
import { useAuth } from '@/components/providers/AuthProvider';
import { useApiQuery } from '@/hooks/use-api';
import { useOrgs } from '@/hooks/use-orgs';

export default function ManageUpgradePage() {
  const { user } = useAuth();
  const { activeOrg } = useOrgs();
  // `/me/plan` resolves the active organization's plan first.
  const { data: currentPlan, isSuccess: planLoaded } = useApiQuery<PlanInfo>({
    queryKey: ['me', 'plan'],
    url: '/api/v1/me/plan',
    enabled: !!user,
  });
  const hasActivePlan = planLoaded ? currentPlan.priceMonthly > 0 : null;

  return (
    <UpgradePlans
      scope="organization"
      currentPlanKey={currentPlan?.key}
      hasActivePlan={hasActivePlan}
      billingHref="/manage/billing"
      orgId={activeOrg?.id}
    />
  );
}
