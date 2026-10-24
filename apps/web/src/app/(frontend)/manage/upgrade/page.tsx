'use client';

import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PlanCard } from '@/app/(frontend)/pricing/_components/pricing-content';
import { useAuth } from '@/components/providers/AuthProvider';
import { useApiQuery } from '@/hooks/use-api';
import { useOrgs } from '@/hooks/use-orgs';

export default function ManageUpgradePage() {
  const ut = useTranslations('UpgradePage');
  const pt = useTranslations('PricingPage');
  const { user } = useAuth();
  const { activeOrg } = useOrgs();

  const { data: plans, isLoading } = useApiQuery<PlanInfo[]>({
    queryKey: ['subscription-plans', 'active', 'manager'],
    url: '/api/v1/subscription-plans?for=manager',
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
              isCurrentPlan={false}
              user={user}
              t={pt}
              accountType="manager"
              orgId={activeOrg?.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
