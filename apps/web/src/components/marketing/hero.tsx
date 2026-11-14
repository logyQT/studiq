'use client';

import { CtaButton } from '@/components/marketing/ui/cta-button';
import { QuizQuestionPreview } from '@/components/marketing/previews/quiz-question-preview';
import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';

export function Hero() {
  const t = useTranslations('LandingPage');

  return (
    <section id="hero" className="border-b border-primary pt-12 pb-12 md:pt-28 md:pb-20">
      {/*
       * `max-w-content`, like every band below: the hero's left column is prose
       * (h1, lede, actions) and its right column is a card, and DESIGN.md gives
       * both the 70rem container. `max-w-media` here set the h1 80px to the left
       * of every following section's heading at 1440.
       */}
      <div className="mx-auto grid max-w-content gap-y-4 px-content lg:grid-cols-12 lg:gap-x-8 lg:gap-y-0">
        {/*
         * The label captions the shot: on lg+ below the specimen, below lg it is the
         * eyebrow. `contents` lets the shot become a grid item of its own on a phone,
         * so it can follow the CTAs while the rail keeps it beside the h1 on desktop:
         * the claim and the actions keep the first screen, and the shot rewards the
         * scroll instead of pushing the form of the page down.
         *
         * The split starts at `lg` and not `md`: at 768 the rail is a quarter of the
         * grid, which leaves the card too narrow for its own footer, so the claim
         * gets the full width until there is room for two columns.
         */}
        <div className="contents lg:col-span-5 lg:col-start-8 lg:row-start-1 lg:flex lg:flex-col lg:border-l-2 lg:border-primary lg:pt-4 lg:pl-8">
          {/*
           * The product itself, not a capture of it: the same component the
           * student answers on, rendered from a fixture. No plate and no border —
           * a rendered component sits on paper (DESIGN §Product imagery).
           */}
          <div className="order-last mt-4 sm:mt-0 lg:order-1">
            <QuizQuestionPreview />
          </div>
          <p className="font-mono text-xs tracking-[0.08em] text-primary uppercase lg:order-2 lg:mt-3">
            {t('hero_badge')}
          </p>
        </div>

        <div className="lg:col-span-7 lg:col-start-1 lg:row-start-1">
          <h1 className="font-display text-display font-semibold text-balance">
            {t('hero_title_lead')}{' '}
            <span className="hand-mark">
              {t('hero_title_mark')}
              {/* One hand-drawn stroke under the operative half; see globals.css. */}
              <svg viewBox="0 0 600 22" preserveAspectRatio="none" aria-hidden focusable="false">
                <path d="M5 13 C 78 7 148 16 222 10 S 362 5 438 12 S 546 16 595 11" />
              </svg>
            </span>
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
