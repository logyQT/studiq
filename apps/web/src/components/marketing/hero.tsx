'use client';

import { CtaButton } from '@/components/marketing/ui/cta-button';
import { ProductShot } from '@/components/marketing/ui/product-shot';
import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';

export function Hero() {
  const t = useTranslations('LandingPage');

  return (
    <section id="hero" className="border-b border-border pt-12 pb-12 md:pt-28 md:pb-20">
      <div className="mx-auto grid max-w-media gap-y-4 px-content md:grid-cols-12 md:gap-x-8 md:gap-y-0">
        {/*
         * The label rides the measure rule instead of sitting over the headline as
         * a pill: on md+ it captions the shot, below md it is the eyebrow.
         * `contents` lets the shot become a grid item of its own on a phone, so it
         * can follow the CTAs while the rail keeps it beside the h1 on desktop: the
         * claim and the actions keep the first screen, and the shot rewards the
         * scroll instead of pushing the form of the page down.
         */}
        <div className="contents relative md:col-span-4 md:col-start-9 md:row-start-1 md:flex md:flex-col md:border-l md:border-border md:pt-4 md:pl-8 lg:col-span-5 lg:col-start-8">
          <span
            aria-hidden
            className="absolute top-0 -left-px hidden h-6 w-0.5 bg-primary md:block"
          />
          <ProductShot
            shot="quiz-taking"
            alt={t('shot_quiz_alt')}
            sizes="(min-width: 1280px) 456px, (min-width: 1024px) 36vw, (min-width: 768px) 30vw, calc(100vw - 2rem)"
            preload
            className="order-last mt-4 md:order-1 md:mt-0"
          />
          <p className="font-mono text-xs tracking-[0.08em] text-muted-foreground uppercase md:order-2 md:mt-3">
            {t('hero_badge')}
          </p>
        </div>

        <div className="md:col-span-8 md:col-start-1 md:row-start-1 lg:col-span-7">
          <h1 className="font-display text-display font-semibold text-balance">
            {t('hero_title')}
          </h1>
          <p className="mt-4 max-w-xl text-lede text-muted-foreground text-pretty md:mt-6">
            {t('hero_subtitle')}
          </p>
          {/*
           * Below md the two actions stack and fill the column: side by side at
           * 390px they wrap into two ragged widths, which reads as a layout
           * accident rather than as one primary and one secondary action.
           */}
          <div className="mt-8 flex flex-col gap-3 md:mt-10 md:flex-row md:flex-wrap md:items-center">
            <CtaButton href="/register" tone="signal">
              {t('cta_start')}
            </CtaButton>
            <CtaButton href="/features" tone="quiet">
              {t('cta_features')}
              <ArrowRight className="size-4" aria-hidden />
            </CtaButton>
          </div>
        </div>
      </div>
    </section>
  );
}
