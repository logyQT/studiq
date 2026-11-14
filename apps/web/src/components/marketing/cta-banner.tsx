'use client';

import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { CtaButton } from '@/components/marketing/ui/cta-button';

/**
 * The page's one full-bleed cobalt area. `text-primary-foreground` keeps the contrast correct
 * in both modes (paper on cobalt in light, ink on cobalt in dark).
 */
export function CtaBanner() {
  const t = useTranslations('LandingPage');

  return (
    <section id="get-started" className="bg-primary text-primary-foreground">
      <div className="mx-auto max-w-content px-content py-16 md:py-20">
        <div className="grid gap-6 md:grid-cols-12 md:items-end md:gap-8">
          <div className="md:col-span-7">
            <h2 className="font-display text-h2 font-semibold text-balance">
              {t('cta_banner_title')}
            </h2>
            <p className="mt-4 max-w-xl text-lede">{t('cta_banner_desc')}</p>
          </div>
          <div className="flex flex-col md:col-span-5 md:block md:justify-self-end">
            <CtaButton href="/register" tone="signal">
              {t('cta_banner_button')}
              <ArrowRight aria-hidden="true" className="size-4" />
            </CtaButton>
          </div>
        </div>
      </div>
    </section>
  );
}
