'use client';

import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import { useLocale, useTranslations } from 'next-intl';
import { PlanAction } from '@/components/pricing/plan-action';
import { formatPlanPrice } from '@/lib/landing-pricing';
import { planCopy } from '@/lib/pricing-copy';
import { isRecommendedPlan, shortPlanName } from '@/lib/pricing-ladders';
import { pricingPlanAction } from '@/lib/pricing-plan-action';

interface PlanRowProps {
  plan: PlanInfo;
  isCurrent: boolean;
  signedIn: boolean;
  /**
   * The reader owns a paid subscription, so checkout would be refused. `null`
   * while that answer is pending or failed: the row then prints no action.
   */
  hasActivePlan: boolean | null;
  /** Where a subscriber changes plan: their own billing page or the org's. */
  billingHref: string;
  /** Active organization; organization plans are bought for it. */
  orgId?: string;
}

/**
 * One line of the printed price list: rules carry the separation, so the row is
 * not a card. The comparison tables are the feature surface, so no bullet list
 * repeats them here.
 */
export function PlanRow({
  plan,
  isCurrent,
  signedIn,
  hasActivePlan,
  billingHref,
  orgId,
}: PlanRowProps) {
  const t = useTranslations('PricingPage');
  const locale = useLocale();

  const recommended = isRecommendedPlan(plan.key);
  const isFree = plan.priceMonthly === 0;
  /** Sales-led tier: it is priced per institution, not per seat. */
  const contactOnly = plan.key === 'campus';
  const { description, note } = planCopy(t, plan);
  // A plan cannot be both: the reader's own subscription wins over the page's pick.
  const label = isCurrent ? t('current_plan_badge') : recommended ? t('recommended_badge') : null;
  // The ladder has one signal fill; the plan the reader already owns never takes it.
  const primary = recommended && !isCurrent;
  const action = pricingPlanAction({ signedIn, isCurrent, isFree, contactOnly, hasActivePlan });

  return (
    <li className="border-b border-border py-6 md:grid md:grid-cols-12 md:items-start md:gap-x-8">
      {/*
       * At phone the name and the figure share one baseline row; from md the
       * wrapper dissolves (`contents`) and its two children become the price
       * list's first and third columns.
       */}
      <div className="flex items-baseline justify-between gap-4 md:contents">
        <div className="min-w-0 md:col-span-4 md:col-start-1 md:row-start-1">
          {/* The label shares the name's baseline, like the landing's columns. */}
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h3 id={plan.key} className="scroll-mt-header text-h3 font-semibold">
              {shortPlanName(plan.name)}
            </h3>
            {label ? (
              <span className="font-mono text-xs tracking-[0.08em] text-primary uppercase">
                {label}
              </span>
            ) : null}
          </div>
        </div>
        <p className="text-right md:col-span-2 md:col-start-9 md:row-start-1 md:justify-self-end">
          <span className="font-mono text-base tabular-nums md:text-h3">
            {isFree ? t('price_free') : formatPlanPrice(plan, locale)}
          </span>
          {isFree ? null : (
            <span className="ml-1.5 text-xs text-muted-foreground">{t('period_month')}</span>
          )}
        </p>
      </div>

      <div className="mt-3 md:col-span-4 md:col-start-5 md:row-start-1 md:mt-0">
        {/* No copy, no line: `description` is the seed's admin-internal column. */}
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        {note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}
      </div>

      <div className="mt-4 md:col-span-2 md:col-start-11 md:row-start-1 md:mt-0 md:justify-self-end">
        <PlanAction
          plan={plan}
          action={action}
          tone={primary ? 'signal' : 'quiet'}
          billingHref={billingHref}
          orgId={orgId}
          registerLabel={isFree ? t('cta_free') : t('cta_register')}
          className="whitespace-nowrap"
        />
      </div>
    </li>
  );
}
