'use client';

import { Loader2, Minus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useAuth } from '@/components/providers/AuthProvider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useApiQuery } from '@/hooks/use-api';
import type { PlanInfo } from '@/server/services/subscription-plan.service';

const SORTED_LIMIT_KEYS = [
  'max_flashcards',
  'max_decks',
  'max_questions',
  'max_question_banks',
  'max_quiz_attempts_per_day',
  'max_ai_tokens_per_day',
  'max_students',
  'max_groups',
  'max_storage_mb',
];

export default function AppBillingPage() {
  const t = useTranslations('BillingPage');
  const pt = useTranslations('PricingPage');
  const locale = useLocale();
  const { user } = useAuth();
  const { data: plan, isLoading } = useApiQuery<PlanInfo>({
    queryKey: ['me', 'plan'],
    url: '/api/v1/me/plan',
    enabled: !!user,
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
    const label = pt(`feature_${key}`);
    return label.startsWith('feature_') ? key : label;
  }

  function getLimitLabel(key: string): string {
    const label = pt(`limit_${key}`);
    return label.startsWith('limit_') ? key : label;
  }

  const visibleLimits = SORTED_LIMIT_KEYS.filter((k) => k in plan.limits);

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
    </div>
  );
}
