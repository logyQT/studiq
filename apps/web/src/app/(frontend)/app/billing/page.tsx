'use client';

import { AccountType } from '@studiq/authz';
import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import type { BillingSubscriptionView } from '@studiq/server/services/billing.service';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Separator,
} from '@studiq/ui';
import { Loader2, Minus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { BillingSubscriptionCard } from '@/components/billing/BillingSubscriptionCard';
import { getFeatureLabel as getFeatureLabelShared } from '@/lib/pricing-features';
import { getVisibleLimitKeys } from '@/lib/pricing-limits';
import { useAuth } from '@/components/providers/AuthProvider';
import { useApiQuery } from '@/hooks/use-api';
import { invoiceHistoryPath } from '@/lib/billing-subscription';
import { billingKeys } from '@/lib/query-keys';

export default function AppBillingPage() {
  const t = useTranslations('BillingPage');
  const pt = useTranslations('PricingPage');
  const locale = useLocale();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  // `app_metadata` is an untyped Supabase map; `account_type` must be narrowed.
  const rawAccountType: unknown = user?.app_metadata?.account_type;
  const accountType =
    (typeof rawAccountType === 'string' ? rawAccountType : undefined) ?? 'student';
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

  const hasPrice = plan.priceMonthly > 0;
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: plan.currency,
  });

  function getFeatureLabel(key: string): string {
    return getFeatureLabelShared(key, pt);
  }

  function getLimitLabel(key: string): string {
    const label = pt(`limit_${key}`);
    return label.startsWith('limit_') ? key : label;
  }

  const visibleLimits = getVisibleLimitKeys([plan], accountType);
  const historyPath = invoiceHistoryPath(AccountType.STUDENT);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground mt-1">{t('subtitle')}</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t('current_plan')}</CardTitle>
              <CardDescription>{plan.name}</CardDescription>
            </div>
            <Badge variant={hasPrice ? 'default' : 'secondary'}>
              {hasPrice ? t('active') : t('free')}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold">{formatter.format(plan.priceMonthly / 100)}</span>
            <span className="text-muted-foreground">
              {hasPrice ? t('period_month') : t('free_forever')}
            </span>
          </div>

          <Separator />

          {plan.features.length > 0 && (
            <ul className="space-y-2">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-center gap-2 text-sm">
                  <span>{getFeatureLabel(feature)}</span>
                </li>
              ))}
            </ul>
          )}

          {visibleLimits.length > 0 && (
            <>
              <Separator />
              <div className="space-y-1.5">
                {visibleLimits.map((key) => {
                  const value = plan.limits[key];
                  return (
                    <div key={key} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{getLimitLabel(key)}</span>
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
            <Button className="w-full" onClick={() => (window.location.href = '/app/upgrade')}>
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
        accountType={AccountType.STUDENT}
        onChanged={() => {
          void queryClient.invalidateQueries({ queryKey: ['me', 'plan'] });
          void refetchSubscription();
        }}
      />
    </div>
  );
}
