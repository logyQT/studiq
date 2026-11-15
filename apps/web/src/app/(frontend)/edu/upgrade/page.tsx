'use client';

import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import { UpgradePlans } from '@/components/billing/upgrade-plans';
import { useAuth } from '@/components/providers/AuthProvider';
import { useApiQuery } from '@/hooks/use-api';

export default function EduUpgradePage() {
  const { user } = useAuth();

  // The effective plan (the seat plan of a seated teacher), the same one the plan page shows (#270).
  const { data: currentPlan } = useApiQuery<PlanInfo>({
    queryKey: ['me', 'plan'],
    url: '/api/v1/me/plan',
    enabled: !!user,
  });

  return <UpgradePlans audience="educator" currentPlanKey={currentPlan?.key} />;
}
