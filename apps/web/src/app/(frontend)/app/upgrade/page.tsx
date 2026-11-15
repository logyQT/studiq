'use client';

import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import { UpgradePlans } from '@/components/billing/upgrade-plans';
import { useAuth } from '@/components/providers/AuthProvider';
import { useApiQuery } from '@/hooks/use-api';

export default function AppUpgradePage() {
  const { user } = useAuth();

  const { data: currentPlan } = useApiQuery<PlanInfo>({
    queryKey: ['me', 'personal-plan'],
    url: '/api/v1/me/personal-plan',
    enabled: !!user,
  });

  return <UpgradePlans audience="student" currentPlanKey={currentPlan?.key} />;
}
