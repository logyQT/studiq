'use client';

import { Button } from '@studiq/ui';
import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { apiPost } from '@/lib/api';
import { checkoutSessionBody } from '@/lib/checkout-entry';

interface CheckoutButtonProps {
  /** Catalog plan key (`spark`, `hub`, …), never the plan UUID. */
  planKey: string;
  /** Organization the plan is bought for; required for organization (manager) plans. */
  orgId?: string;
  children: React.ReactNode;
  variant?: 'default' | 'outline';
  className?: string;
}

export function CheckoutButton({
  planKey,
  orgId,
  children,
  variant = 'default',
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
    <Button className={className} variant={variant} onClick={handleClick} disabled={isLoading}>
      {isLoading && <Loader2 className="size-4 mr-2 animate-spin" />}
      {children}
    </Button>
  );
}
