'use client';

import { AccountType } from '@studiq/authz';
import type { BillingSubscriptionView } from '@studiq/server/services/billing.service';
import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import { Button, Card, CardContent, Skeleton } from '@studiq/ui';
import { Mail, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { BillingPageShell, CurrentPlanCardHeader } from '@/components/billing/billing-page-parts';
import { BillingSubscriptionCard } from '@/components/billing/BillingSubscriptionCard';
import { PlanUnionBadge } from '@/components/billing/plan-union-badge';
import { useAuth } from '@/components/providers/AuthProvider';
import { useApiQuery } from '@/hooks/use-api';
import { useOrgs } from '@/hooks/use-orgs';
import { invalidateAuthority } from '@/lib/query-cache';
import { billingKeys } from '@/lib/query-keys';

/**
 * Organization billing (#662 §7.4): the organization plan, the seats already
 * provisioned (existing seats API), the shared subscription read model, and the
 * provider actions. The contact-sales mailto stays as a secondary option for
 * custom plans; it is no longer the only action.
 */
export default function ManageBillingPage() {
  const t = useTranslations('BillingPage');
  const { user } = useAuth();
  const { activeOrg, isPending: orgsPending } = useOrgs();
  const queryClient = useQueryClient();
  // /me/plan resolves the active organization's plan first (personal plan only as fallback).
  const { data: myPlan, isLoading: planLoading } = useApiQuery<PlanInfo>({
    queryKey: ['me', 'plan'],
    url: '/api/v1/me/plan',
    enabled: !!user,
  });
  const { data: plans, isLoading: plansLoading } = useApiQuery<PlanInfo[]>({
    queryKey: ['subscription-plans', 'active'],
    url: '/api/v1/subscription-plans',
    enabled: !!user,
  });
  const {
    data: subscription,
    isError: subscriptionError,
    refetch: refetchSubscription,
  } = useApiQuery<BillingSubscriptionView>({
    queryKey: billingKeys.subscription(activeOrg?.id),
    url: '/api/v1/billing/subscription',
    enabled: !!user && !orgsPending,
    staleTime: 0,
  });
  const { data: seatPools } = useApiQuery<{ total: number; assigned: number }[]>({
    queryKey: billingKeys.seatPools(activeOrg?.id),
    url: '/api/v1/organization/seats/pools',
    enabled: !!user && !!activeOrg?.id,
    staleTime: 0,
  });

  const seatsTotal = seatPools?.reduce((sum, pool) => sum + pool.total, 0) ?? 0;
  const seatsUsed = seatPools?.reduce((sum, pool) => sum + pool.assigned, 0) ?? 0;

  return (
    <BillingPageShell>
      <Card>
        <CurrentPlanCardHeader
          description={t('org_plan')}
          badge={
            planLoading || plansLoading ? (
              <Skeleton className="h-6 w-24" />
            ) : myPlan ? (
              <PlanUnionBadge plan={myPlan} plans={plans} />
            ) : null
          }
        />
        <CardContent className="space-y-4">
          {seatsTotal > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <Users className="size-4 text-muted-foreground" />
              <span>{t('seats_used', { used: seatsUsed, total: seatsTotal })}</span>
            </div>
          )}
          <p className="text-sm text-muted-foreground">{t('org_contact')}</p>
          <Button variant="outline" asChild>
            <a href="mailto:sales@studiq.app">
              <Mail className="size-4 mr-2" />
              {t('contact_sales')}
            </a>
          </Button>
        </CardContent>
      </Card>

      <BillingSubscriptionCard
        subscription={subscription}
        isError={subscriptionError}
        onRetry={() => {
          void refetchSubscription();
        }}
        plans={plans}
        accountType={AccountType.MANAGER}
        onChanged={() => {
          // A checkout changes the plan layer the resolver reads, so every
          // derived authority answer is stale, not just the plan badge.
          invalidateAuthority(queryClient);
          void refetchSubscription();
        }}
      />
    </BillingPageShell>
  );
}
