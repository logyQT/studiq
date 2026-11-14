'use client';

import { useTranslations } from 'next-intl';
import { SectionHeader } from '@/components/marketing/ui/section-header';

const steps = [
  { titleKey: 'step1_title', descKey: 'step1_desc' },
  { titleKey: 'step2_title', descKey: 'step2_desc' },
  { titleKey: 'step3_title', descKey: 'step3_desc' },
] as const;

/*
 * A sequence, not three columns of equal weight.
 *
 * From md up the steps sit on one continuous hairline rail — the border-top of
 * three adjoining cells with no gutter, each marked by a cobalt tick — so the eye
 * reads 1 -> 2 -> 3 across. The cells keep the full content width while the
 * heading stays in the narrow left column, which is the asymmetry.
 *
 * Below md the sequence turns vertical instead of horizontal: the same rail
 * becomes a left spine and the three steps hang off it in order. A horizontal
 * snap row was tried first and rejected — at 390px the next cell is cut mid-word,
 * which reads as a broken layout rather than an affordance, and a step you cannot
 * see is not a step.
 */
export function HowItWorks() {
  const t = useTranslations('LandingPage');

  return (
    <section id="how-it-works" className="py-16 md:py-20">
      <div className="mx-auto max-w-content px-content">
        <SectionHeader title={t('how_it_works_title')} lede={t('how_it_works_desc')} />

        <ol className="mt-10 md:mt-16 md:grid md:grid-cols-3 md:gap-0">
          {steps.map(({ titleKey, descKey }, index) => (
            <li
              key={titleKey}
              className="relative border-l border-border pt-1 pb-8 pl-6 last:pb-0 md:border-t md:border-l-0 md:pt-6 md:pr-10 md:pb-0 md:pl-0"
            >
              <span
                aria-hidden="true"
                className="absolute top-1 -left-px h-3 w-0.5 bg-primary md:top-0 md:left-0 md:w-px"
              />
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
