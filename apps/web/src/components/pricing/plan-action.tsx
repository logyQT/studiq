'use client';

import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import { useTranslations } from 'next-intl';
import { CtaButton } from '@/components/marketing/ui/cta-button';
import { CheckoutButton } from '@/components/pricing/checkout-button';
import { ctaMessageKey, isRecommendedPlan } from '@/lib/pricing-ladders';
import type { PlanAction as PlanActionKind } from '@/lib/pricing-plan-action';

interface PlanActionProps {
  plan: PlanInfo;
  action: PlanActionKind;
  /** Where a subscriber changes plan: their own billing page or the org's. */
  billingHref: string;
  /** Active organization; organization plans are bought for it. */
  orgId?: string;
  /**
   * A signed-out reader registers, and the price list names that verb while the
   * dashboard card keeps the plan's own label.
   */
  registerLabel?: string;
  /** Layout only: the price list's action column is narrower than a card. */
  className?: string;
}

/**
 * The one action a plan surface prints, for both the price list and the dashboard
 * grid. It exists because the two surfaces render the same row of actions: a
 * navigation, a POST and a disabled state in one column must share one control
 * look, or the row shows two button implementations side by side.
 *
 * `none` prints nothing: an empty cell reads as a broken row, but a plan with no
 * action (another free tier, or a pending plan read) has nothing to name.
 */
export function PlanAction({
  plan,
  action,
  billingHref,
  orgId,
  registerLabel,
  className,
}: PlanActionProps) {
  const t = useTranslations('PricingPage');
  const ctaKey = ctaMessageKey(plan);
  const label = t.has(ctaKey) ? t(ctaKey) : t('cta_generic');
  // One `signal` fill per surface, never on the plan the reader already owns.
  const tone = isRecommendedPlan(plan.key) && action !== 'current' ? 'signal' : 'quiet';

  if (action === 'contact') {
    // A sales-led plan is a conversation, not a self-serve checkout: the label
    // says contact sales, so the action under it must too. `quiet` is explicit:
    // the default fill is `signal`, and a sales link beside the ladder's
    // recommended plan would be a second primary pointing away from the product.
    return (
      <CtaButton href="/contact" tone="quiet" fullWidth className={className}>
        {label}
      </CtaButton>
    );
  }

  if (action === 'current') {
    return (
      <CtaButton action="button" tone={tone} disabled fullWidth className={className}>
        {t('cta_current')}
      </CtaButton>
    );
  }

  if (action === 'register') {
    return (
      <CtaButton href="/register" tone={tone} fullWidth className={className}>
        {registerLabel ?? label}
      </CtaButton>
    );
  }

  if (action === 'change-plan') {
    /*
     * A second subscription is refused by the server, so the subscriber's
     * upgrade, downgrade and proration run on the billing page, which owns the
     * plan change.
     */
    return (
      <CtaButton href={billingHref} tone={tone} fullWidth className={className}>
        {t('cta_change_plan')}
      </CtaButton>
    );
  }

  if (action === 'checkout') {
    /*
     * The server decides whether an organization plan is billable by this caller;
     * the button reports its refusal.
     */
    return (
      <CheckoutButton
        planKey={plan.key}
        orgId={plan.scope === 'organization' ? orgId : undefined}
        tone={tone}
        className={className}
      >
        {label}
      </CheckoutButton>
    );
  }

  return null;
}
