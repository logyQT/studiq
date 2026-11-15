'use client';

import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Separator } from '@studiq/ui';
import { Check, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { CheckoutButton } from '@/components/pricing/checkout-button';
import { getFeatureLabel, type PricingTranslator } from '@/lib/pricing-features';

const PLAN_ID_MAP: Record<string, string | null> = {
  base: null,
  lite: null,
  launch: null,
  spark: 'spark',
  ace: 'ace',
  pro: 'pro',
  guide: 'guide',
  creator: 'creator',
  master: 'master',
  team: 'team',
  hub: 'hub',
  campus: 'campus',
};

const CTA_KEY_MAP: Record<string, string> = {
  base: 'cta_free',
  spark: 'cta_spark',
  ace: 'cta_ace',
  pro: 'cta_pro',
  lite: 'cta_free',
  guide: 'cta_guide',
  creator: 'cta_creator',
  master: 'cta_master',
  launch: 'cta_free',
  team: 'cta_team',
  hub: 'cta_hub',
  campus: 'cta_campus',
};

export function PlanCard({
  plan,
  isCurrentPlan,
  user,
  t,
  accountType,
  orgId,
}: {
  plan: PlanInfo;
  isCurrentPlan: boolean;
  user: unknown;
  t: PricingTranslator;
  accountType: string;
  /** Active organization; organization plans are bought for it. */
  orgId?: string;
}) {
  const locale = useLocale();
  const descKey = `plan_${plan.key}_desc`;
  const noteKey = `plan_${plan.key}_note`;
  const description = t.has(descKey) ? t(descKey) : (plan.description ?? '');
  const note = t.has(noteKey) ? t(noteKey) : null;
  const ctaKey = CTA_KEY_MAP[plan.key];
  const ctaLabel = ctaKey && t.has(ctaKey) ? t(ctaKey) : t('cta_generic');
  const popular =
    accountType === 'student'
      ? plan.key === 'ace'
      : accountType === 'educator'
        ? plan.key === 'creator'
        : plan.key === 'hub';

  return (
    <Card
      className={`flex flex-col relative ${popular ? 'border-primary shadow-lg' : 'border-border/50'}`}
    >
      {popular && (
        <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
          <Sparkles className="size-3 mr-1" />
          {t('most_popular')}
        </Badge>
      )}
      {isCurrentPlan && (
        <Badge variant="secondary" className="absolute -top-3 right-4 z-10">
          {t('current_plan_badge')}
        </Badge>
      )}
      <CardHeader className="pb-4">
        <CardTitle className="text-xl">{plan.name}</CardTitle>
        <p className="text-sm">{description}</p>
        {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      </CardHeader>
      <CardContent className="flex flex-col flex-1">
        <div className="mb-6">
          <span className="text-4xl font-bold">
            {new Intl.NumberFormat(locale, {
              style: 'currency',
              currency: plan.currency,
              minimumFractionDigits: 0,
            }).format(plan.priceMonthly / 100)}
          </span>
          {plan.priceMonthly > 0 && (
            <span className="text-sm text-muted-foreground ml-1">{t('period_month')}</span>
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

        {user && PLAN_ID_MAP[plan.key] ? (
          <CheckoutButton
            planKey={PLAN_ID_MAP[plan.key]!}
            orgId={plan.forAccountType === 'manager' ? orgId : undefined}
            className="w-full"
          >
            {ctaLabel}
          </CheckoutButton>
        ) : (
          <Button className="w-full" variant={popular ? 'default' : 'outline'} asChild>
            <Link href={user ? '/app' : '/register'}>{ctaLabel}</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
