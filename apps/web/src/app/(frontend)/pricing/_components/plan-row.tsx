'use client';

import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import { useLocale, useTranslations } from 'next-intl';
import { CtaButton } from '@/components/marketing/ui/cta-button';
import { CheckoutButton } from '@/components/pricing/checkout-button';
import { formatPlanPrice } from '@/lib/landing-pricing';
import {
  canPurchasePlan,
  ctaMessageKey,
  isRecommendedPlan,
  planFamilyLabelKey,
  shortPlanName,
} from '@/lib/pricing-ladders';
import { cn } from '@/lib/utils';

interface PlanRowProps {
  plan: PlanInfo;
  isCurrent: boolean;
  signedIn: boolean;
  /** The reader's own account family; null for a visitor. */
  viewerAccountType: string | null;
  /** Active organization; organization plans are bought for it. */
  orgId?: string;
}

/**
 * One line of the printed price list: rules carry the separation, so the row is
 * not a card. The comparison tables are the feature surface, so no bullet list
 * repeats them here.
 */
export function PlanRow({ plan, isCurrent, signedIn, viewerAccountType, orgId }: PlanRowProps) {
  const t = useTranslations('PricingPage');
  const locale = useLocale();

  const recommended = isRecommendedPlan(plan.key);
  const isFree = plan.priceMonthly === 0;
  /** Sales-led tier: it is priced per institution, not per seat. */
  const contactOnly = plan.key === 'campus';
  const descKey = `plan_${plan.key}_desc`;
  const noteKey = `plan_${plan.key}_note`;
  const ctaKey = ctaMessageKey(plan);
  const description = t.has(descKey) ? t(descKey) : null;
  const note = t.has(noteKey) ? t(noteKey) : null;
  const familyLabelKey = planFamilyLabelKey(plan);
  // A signed-in reader is only offered the family their account can check out.
  const otherFamily = signedIn && !canPurchasePlan(plan, viewerAccountType);
  // A plan cannot be both: the reader's own subscription wins over the page's pick.
  const label = isCurrent ? t('current_plan_badge') : recommended ? t('recommended_badge') : null;

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
        {contactOnly ? (
          /*
           * Campus is a 699 zł conversation, not a self-serve checkout, and the
           * label says so in both states: signing in must not turn a sales
           * contact into a purchase (one behaviour per label).
           */
          <CtaButton href="/contact" tone="quiet" fullWidth className="whitespace-nowrap">
            {t.has(ctaKey) ? t(ctaKey) : t('cta_generic')}
          </CtaButton>
        ) : otherFamily ? (
          /*
           * A family the reader's account cannot check out has no action at all:
           * a button here would be refused by the server (#1274). The label says
           * who the plan is for, so the row still explains itself.
           */
          <span className="inline-flex min-h-11 items-center text-xs text-balance text-muted-foreground md:justify-self-end">
            {familyLabelKey ? t(familyLabelKey) : null}
          </span>
        ) : signedIn ? (
          isFree ? null : (
            <CheckoutButton
              planKey={plan.key}
              orgId={plan.forAccountType === 'manager' ? orgId : undefined}
              variant={recommended ? 'default' : 'outline'}
              className={cn(
                'h-11 w-full rounded-control px-6 text-sm font-semibold',
                // The kit's outline edge is the decorative `--border` (1.32:1); a
                // button identified by its edge needs `--input` (3.23:1).
                recommended
                  ? 'border-transparent bg-signal text-signal-foreground hover:bg-signal/90'
                  : 'border-input',
              )}
            >
              {t.has(ctaKey) ? t(ctaKey) : t('cta_generic')}
            </CheckoutButton>
          )
        ) : (
          <CtaButton
            href="/register"
            tone={recommended ? 'signal' : 'quiet'}
            fullWidth
            className="whitespace-nowrap"
          >
            {isFree ? t('cta_free') : t('cta_register')}
          </CtaButton>
        )}
      </div>
    </li>
  );
}
