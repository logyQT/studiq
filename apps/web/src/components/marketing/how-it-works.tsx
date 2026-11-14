'use client';

import { useTranslations } from 'next-intl';
import { SectionHeader } from '@/components/marketing/ui/section-header';

const steps = [
  { titleKey: 'step1_title', descKey: 'step1_desc' },
  { titleKey: 'step2_title', descKey: 'step2_desc' },
  { titleKey: 'step3_title', descKey: 'step3_desc' },
] as const;

/*
 * A sequence, not three columns of equal weight. The steps sit on one continuous
 * hairline rail: the border-top of three adjoining cells with no gutter between
 * them, each marked by a cobalt tick, so the eye reads 1 -> 2 -> 3 left to right
 * instead of scanning a row of cards. The cells keep the full content width while
 * the heading stays in the narrow left column, which is the asymmetry.
 *
 * Below md the same rail becomes a horizontal snap row: the three steps are one
 * gesture long instead of three more paragraphs stacked down the page, and the
 * next cell's edge stays in view so the sequence is obviously scrollable. The
 * list itself is the scroll region, so it takes focus and arrow keys work; no
 * cell is a tab stop and nothing inside it traps focus.
 */
/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- the rail is a scroll region, not a control: focus is what makes arrow-key scrolling reach it, and a button/region role would replace the list announcement the sequence depends on. */
export function HowItWorks() {
  const t = useTranslations('LandingPage');

  return (
    <section id="how-it-works" className="py-16 md:py-20">
      <div className="mx-auto max-w-content px-content">
        <SectionHeader title={t('how_it_works_title')} lede={t('how_it_works_desc')} />

        <ol
          tabIndex={0}
          className="-mx-4 mt-10 flex snap-x snap-mandatory gap-4 scroll-px-4 overflow-x-auto px-4 pb-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none sm:-mx-6 sm:scroll-px-6 sm:px-6 md:mx-0 md:mt-16 md:grid md:grid-cols-3 md:gap-0 md:overflow-visible md:px-0 md:pb-0"
        >
          {steps.map(({ titleKey, descKey }, index) => (
            <li
              key={titleKey}
              className="relative w-4/5 shrink-0 snap-start border-t border-border pt-6 pb-4 md:w-auto md:pr-10 md:pb-0"
            >
              <span aria-hidden="true" className="absolute top-0 left-0 h-3 w-px bg-primary" />
              <p className="font-mono text-xs tracking-[0.08em] text-muted-foreground uppercase">
                {t('step_label', { number: index + 1 })}
              </p>
              <h3 className="mt-3 text-h3 font-semibold">{t(titleKey)}</h3>
              <p className="mt-2 max-w-prose text-sm leading-snug text-muted-foreground md:leading-relaxed">
                {t(descKey)}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
