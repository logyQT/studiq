'use client';

import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import { useLocale, useTranslations } from 'next-intl';
import { CtaButton } from '@/components/marketing/ui/cta-button';
import { CheckoutButton } from '@/components/pricing/checkout-button';
import { formatPlanPrice } from '@/lib/landing-pricing';
import { isRecommendedPlan, shortPlanName } from '@/lib/pricing-ladders';
import { cn } from '@/lib/utils';

interface PlanRowProps {
  plan: PlanInfo;
  isCurrent: boolean;
  signedIn: boolean;
  /** Active organization; organization plans are bought for it. */
  orgId?: string;
}

/**
 * One line of the printed price list: rules carry the separation, so the row is
 * not a card. The comparison tables are the feature surface, so no bullet list
 * repeats them here.
 */
export function PlanRow({ plan, isCurrent, signedIn, orgId }: PlanRowProps) {
  const t = useTranslations('PricingPage');
  const locale = useLocale();

  const recommended = isRecommendedPlan(plan.key);
  const isFree = plan.priceMonthly === 0;
  /** Sales-led tier: it is priced per institution, not per seat. */
  const contactOnly = plan.key === 'campus';
  const descKey = `plan_${plan.key}_desc`;
  const noteKey = `plan_${plan.key}_note`;
  const ctaKey = `cta_${plan.key}`;
  const description = t.has(descKey) ? t(descKey) : (plan.description ?? '');
  const note = t.has(noteKey) ? t(noteKey) : null;
  // A plan cannot be both: the reader's own subscription wins over the page's pick.
  const label = isCurrent ? t('current_plan_badge') : recommended ? t('most_popular') : null;

  return (
    <li className="border-b border-border py-6 md:grid md:grid-cols-12 md:items-start md:gap-x-8">
      {/*
       * At phone the name and the figure share one baseline row; from md the
       * wrapper dissolves (`contents`) and its two children become the price
       * list's first and third columns.
       */}
      <div className="flex items-baseline justify-between gap-4 md:contents">
        <div className="md:col-span-4 md:col-start-1 md:row-start-1">
          <h3 id={plan.key} className="text-h3 font-semibold">
            {shortPlanName(plan.name)}
          </h3>
          {label ? (
            <p className="mt-1 font-mono text-xs tracking-[0.08em] text-primary uppercase">
              {label}
            </p>
          ) : null}
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
        <p className="text-sm text-muted-foreground">{description}</p>
        {note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}
      </div>

      <div className="mt-4 md:col-span-2 md:col-start-11 md:row-start-1 md:mt-0 md:justify-self-end">
        {signedIn ? (
          isFree ? null : (
            <CheckoutButton
              planKey={plan.key}
              orgId={plan.forAccountType === 'manager' ? orgId : undefined}
              variant={recommended ? 'default' : 'outline'}
              className={cn(
                'h-11 w-full rounded-control px-6 text-sm font-semibold',
                recommended &&
                  'border-transparent bg-signal text-signal-foreground hover:bg-signal/90',
              )}
            >
              {t.has(ctaKey) ? t(ctaKey) : t('cta_generic')}
            </CheckoutButton>
          )
        ) : (
          <CtaButton
            href={contactOnly ? '/contact' : '/register'}
            tone={recommended ? 'signal' : 'quiet'}
            fullWidth
            className="whitespace-nowrap"
          >
            {contactOnly ? t('cta_contact') : isFree ? t('cta_free') : t('cta_register')}
          </CtaButton>
        )}
      </div>
    </li>
  );
}
