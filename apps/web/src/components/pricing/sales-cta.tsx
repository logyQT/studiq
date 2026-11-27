'use client';

import { useTranslations } from 'next-intl';
import { CtaButton } from '@/components/marketing/ui/cta-button';

/**
 * The organization surfaces' one non-plan action: custom limits, SSO, invoicing
 * and onboarding are a conversation, not a fourth checkout. It is separate from
 * the ladder on purpose — a priced card with a "contact" action makes a tier the
 * product does not sell, and it competes with the recommended plan's one `signal`
 * fill. The CTA stays quiet and carries no price.
 */
export function SalesCta() {
  const t = useTranslations('PricingPage');

  return (
    <aside className="mt-12 rounded-xl border border-border p-6 md:flex md:items-center md:justify-between md:gap-8">
      <div>
        <h3 className="text-h3 font-semibold">{t('sales_title')}</h3>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('sales_body')}</p>
      </div>
      <CtaButton href="/contact" tone="quiet" className="mt-4 shrink-0 md:mt-0">
        {t('sales_cta')}
      </CtaButton>
    </aside>
  );
}
