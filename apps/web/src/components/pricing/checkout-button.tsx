'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { CtaButton } from '@/components/marketing/ui/cta-button';
import { apiPost } from '@/lib/api';
import { checkoutSessionBody } from '@/lib/checkout-entry';

interface CheckoutButtonProps {
  /** Catalog plan key (`spark`, `hub`, …), never the plan UUID. */
  planKey: string;
  /** Organization the plan is bought for; required for organization (manager) plans. */
  orgId?: string;
  children: React.ReactNode;
  /**
   * The row's rule, not the caller's taste: the recommended plan's action carries
   * the page's one `signal` fill, every other action stays `quiet`.
   */
  tone?: 'signal' | 'quiet';
  /** Layout only: the price list's action column is narrower than a card. */
  className?: string;
}

/**
 * The plan surfaces mix navigation and this POST in one column, so the button is
 * `CtaButton`'s `action` branch rather than a second control look.
 */
export function CheckoutButton({
  planKey,
  orgId,
  children,
  tone = 'quiet',
  className,
}: CheckoutButtonProps) {
  const t = useTranslations('CheckoutPage');
  const locale = useLocale();
  const [isLoading, setIsLoading] = useState(false);

  async function handleClick() {
    setIsLoading(true);
    try {
      const data = await apiPost<{ url: string }>(
        '/api/v1/stripe/create-checkout-session',
        checkoutSessionBody({
          planKey,
          orgId,
          locale: locale === 'en' ? 'en' : 'pl',
        }),
      );
      window.location.href = data.url;
    } catch {
      toast.error(t('payment_failed'));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <CtaButton
      action="button"
      tone={tone}
      onClick={handleClick}
      loading={isLoading}
      fullWidth
      className={className}
    >
      {children}
    </CtaButton>
  );
}
