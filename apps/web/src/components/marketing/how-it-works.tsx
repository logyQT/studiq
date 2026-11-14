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
 * From md up the steps sit on one continuous cobalt rail — the border-top of
 * three adjoining cells with no gutter — so the eye reads 1 -> 2 -> 3 across,
 * under a heading that keeps the narrow left column. Below md the sequence turns
 * vertical instead of horizontal: the same rail becomes a left spine and the
 * three steps hang off it in order. A horizontal snap row was tried first and
 * rejected — at 390px the next cell is cut mid-word, which reads as a broken
 * layout rather than an affordance, and a step you cannot see is not a step.
 *
 * The rail is cobalt because it is the section's structure rather than its data:
 * hairlines still carry the ledgers and the pricing rows, and the sequence is the
 * one line on the page that is the product's process.
 *
 * Top padding is short of the section default on purpose: measured content to
 * content, the gap above this section was 200px at md — the 160px rhythm plus
 * the previous section's trailing line box — which made the empty band taller
 * than any block on the page. This section gives that surplus back.
 */
export function HowItWorks() {
  const t = useTranslations('LandingPage');

  return (
    <section id="how-it-works" className="pt-8 pb-16 md:pt-10 md:pb-20">
      <div className="mx-auto max-w-content px-content">
        <SectionHeader title={t('how_it_works_title')} lede={t('how_it_works_desc')} />

        <ol className="mt-10 md:mt-16 md:grid md:grid-cols-3 md:gap-0">
          {steps.map(({ titleKey, descKey }, index) => (
            <li
              key={titleKey}
              className="border-l-2 border-primary pt-1 pb-8 pl-6 last:pb-0 md:border-t-2 md:border-l-0 md:pt-6 md:pr-10 md:pb-0 md:pl-0"
            >
              <p className="font-mono text-xs tracking-[0.08em] text-primary uppercase">
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
