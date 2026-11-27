'use client';

import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import { Badge, Card, CardContent, CardHeader, CardTitle, Separator } from '@studiq/ui';
import { Check, Sparkles } from 'lucide-react';
import { useLocale } from 'next-intl';
import { CtaButton } from '@/components/marketing/ui/cta-button';
import { PlanAction } from '@/components/pricing/plan-action';
import { ctaMessageKey, isRecommendedPlan } from '@/lib/pricing-ladders';
import { planCopy } from '@/lib/pricing-copy';
import { getFeatureLabel, type PricingTranslator } from '@/lib/pricing-features';
import { pricingPlanAction } from '@/lib/pricing-plan-action';

export function PlanCard({
  plan,
  isCurrentPlan,
  user,
  t,
  orgId,
  hasActivePlan,
  billingHref,
}: {
  plan: PlanInfo;
  isCurrentPlan: boolean;
  user: unknown;
  t: PricingTranslator;
  /** Active organization; organization plans are bought for it. */
  orgId?: string;
  /** The reader owns a paid subscription; `null` while that read is pending or failed. */
  hasActivePlan: boolean | null;
  /** Where a subscriber changes plan: their own billing page or the org's. */
  billingHref: string;
}) {
  const locale = useLocale();
  const { description, note } = planCopy(t, plan);
  const ctaKey = ctaMessageKey(plan);
  const ctaLabel = t.has(ctaKey) ? t(ctaKey) : t('cta_generic');
  const recommended = isRecommendedPlan(plan.key);
  const paid = plan.priceMonthly > 0;
  const action = pricingPlanAction({
    signedIn: Boolean(user),
    isCurrent: isCurrentPlan,
    isFree: !paid,
    contactOnly: plan.key === 'campus',
    hasActivePlan,
  });

  return (
    <Card
      className={`flex flex-col relative ${recommended ? 'border-primary shadow-lg' : 'border-border/50'}`}
    >
      {recommended && !isCurrentPlan && (
        <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
          <Sparkles className="size-3 mr-1" />
          {t('recommended_badge')}
        </Badge>
      )}
      {isCurrentPlan && (
        <Badge variant="secondary" className="absolute -top-3 right-4 z-10">
          {t('current_plan_badge')}
        </Badge>
      )}
      <CardHeader className="pb-4">
        <CardTitle className="text-xl">{plan.name}</CardTitle>
        {/* No copy, no line: `description` is the seed's admin-internal column. */}
        {description ? <p className="text-sm">{description}</p> : null}
        {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      </CardHeader>
      <CardContent className="flex flex-col flex-1">
        <div className="mb-6 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-4xl font-bold break-words">
            {new Intl.NumberFormat(locale, {
              style: 'currency',
              currency: plan.currency,
              minimumFractionDigits: 0,
            }).format(plan.priceMonthly / 100)}
          </span>
          {plan.priceMonthly > 0 && (
            <span className="text-sm text-muted-foreground">{t('period_month')}</span>
          )}
        </div>

        <Separator className="mb-6" />

        <ul className="space-y-3 mb-8 flex-1">
          {plan.features.map((feature) => (
            <li key={feature} className="flex items-center gap-2 text-sm">
              <Check className="h-4 w-4 text-emerald-500 shrink-0" />
              <span>{getFeatureLabel(feature, t)}</span>
            </li>
          ))}
        </ul>

        {action === 'none' ? (
          !paid && user ? (
            // A different free plan is not a subscription the reader changes; the
            // card keeps its link to the app.
            <CtaButton href="/app" tone="quiet" fullWidth>
              {ctaLabel}
            </CtaButton>
          ) : null
        ) : (
          <PlanAction plan={plan} action={action} billingHref={billingHref} orgId={orgId} />
        )}
      </CardContent>
    </Card>
  );
}
