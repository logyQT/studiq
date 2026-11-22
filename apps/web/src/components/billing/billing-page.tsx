'use client';

import type { AccountType } from '@studiq/authz';
import type { BillingSubscriptionView } from '@studiq/server/services/billing.service';
import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import { Badge, Button, Card, CardContent, Separator } from '@studiq/ui';
import { Loader2, Minus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { BillingSubscriptionCard } from '@/components/billing/BillingSubscriptionCard';
import { BillingPageShell, CurrentPlanCardHeader } from '@/components/billing/billing-page-parts';
import { useAuth } from '@/components/providers/AuthProvider';
import { useApiQuery } from '@/hooks/use-api';
import { invoiceHistoryPath } from '@/lib/billing-subscription';
import { getFeatureLabel } from '@/lib/pricing-features';
import { getLimitLabel, getVisibleLimitKeys } from '@/lib/pricing-limits';
import { billingKeys } from '@/lib/query-keys';

interface BillingPageProps {
  accountType: AccountType;
  /** Dashboard the "upgrade" button sends the user to (`/app/upgrade`, `/edu/upgrade`). */
  upgradePath: string;
}

/**
 * Billing dashboard shared by the student and educator apps: current plan, its
 * feature/limit breakdown, the invoice-history link and the subscription
 * actions. The organization dashboard has its own plan/seats read model.
 */
export function BillingPage({ accountType, upgradePath }: BillingPageProps) {
  const t = useTranslations('BillingPage');
  const pt = useTranslations('PricingPage');
  const locale = useLocale();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: plan, isLoading } = useApiQuery<PlanInfo>({
    queryKey: ['me', 'plan'],
    url: '/api/v1/me/plan',
    enabled: !!user,
  });
  const { data: plans } = useApiQuery<PlanInfo[]>({
    queryKey: ['subscription-plans', 'active'],
    url: '/api/v1/subscription-plans',
    enabled: !!user,
  });
  const {
    data: subscription,
    isError: subscriptionError,
    refetch: refetchSubscription,
  } = useApiQuery<BillingSubscriptionView>({
    queryKey: billingKeys.subscription(),
    url: '/api/v1/billing/subscription',
    enabled: !!user,
    staleTime: 0,
  });

  if (isLoading || !plan) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // The header names one plan, so its lists must be that plan's catalogue row:
  // `/me/plan` carries the *effective* composition for programmatic use, whose
  // org-scope limits are 0 outside a verified org and whose feature list is the
  // union of every layer — neither belongs under a single plan's name and price.
  const shown = plans?.find((candidate) => candidate.key === plan.key) ?? plan;

  const hasPrice = plan.priceMonthly > 0;
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: plan.currency,
  });
  const visibleLimits = getVisibleLimitKeys([shown], accountType);
  const historyPath = invoiceHistoryPath(accountType);

  return (
    <BillingPageShell>
      <Card>
        <CurrentPlanCardHeader
          description={plan.name}
          badge={
            <Badge variant={hasPrice ? 'default' : 'secondary'}>
              {hasPrice ? t('active') : t('free')}
            </Badge>
          }
        />
        <CardContent className="space-y-4">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold">{formatter.format(plan.priceMonthly / 100)}</span>
            <span className="text-muted-foreground">
              {hasPrice ? t('period_month') : t('free_forever')}
            </span>
          </div>

          {shown.features.length > 0 && (
            <>
              <Separator />
              <ul className="space-y-2">
                {shown.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-2 text-sm">
                    <span>{getFeatureLabel(feature, pt)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {visibleLimits.length > 0 && (
            <>
              <Separator />
              <div className="space-y-1.5">
                {visibleLimits.map((key) => {
                  const value = shown.limits[key];
                  if (value === undefined) return null;
                  return (
                    <div key={key} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{getLimitLabel(key, pt)}</span>
                      <span className="font-medium tabular-nums">
                        {value === -1 ? (
                          <span className="flex items-center gap-1">
                            <Minus className="size-3" />
                            {pt('limit_unlimited')}
                          </span>
                        ) : (
                          value.toLocaleString(locale)
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {!hasPrice && (
            <Button className="w-full" onClick={() => (window.location.href = upgradePath)}>
              {t('upgrade')}
            </Button>
          )}
        </CardContent>
      </Card>

      {historyPath && (
        <Button variant="link" className="px-0" asChild>
          <a href={historyPath}>{t('invoice_history')}</a>
        </Button>
      )}

      <BillingSubscriptionCard
        subscription={subscription}
        isError={subscriptionError}
        onRetry={() => {
          void refetchSubscription();
        }}
        plans={plans}
        accountType={accountType}
        onChanged={() => {
          void queryClient.invalidateQueries({ queryKey: ['me', 'plan'] });
          void refetchSubscription();
        }}
      />
    </BillingPageShell>
  );
}
