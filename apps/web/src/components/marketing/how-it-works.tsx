'use client';

import { useTranslations } from 'next-intl';
import { ProductShot } from '@/components/marketing/ui/product-shot';
import { SectionHeader } from '@/components/marketing/ui/section-header';

const steps = [
  { titleKey: 'step1_title', descKey: 'step1_desc' },
  { titleKey: 'step2_title', descKey: 'step2_desc' },
  { titleKey: 'step3_title', descKey: 'step3_desc' },
] as const;

/*
 * Only two of the three steps carry a capture: the section is a sequence, and a
 * sequence with a picture under every step is a gallery. Steps 2 and 3 are the
 * ones whose claim is invisible in copy — what a review actually asks of you,
 * and what progress looks like — so the evidence sits there and step 1 stays
 * text, which lets the rail stay the thing you read first.
 */
const proofs = [
  { step: 2, titleKey: 'step2_title', shot: 'card-rating', altKey: 'shot_rating_alt' },
  { step: 3, titleKey: 'step3_title', shot: 'stats-kpis', altKey: 'shot_kpis_alt' },
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

        {/*
         * The exhibits keep the full measure because the captures are element
         * crops at 3x: inside a 3-column step (about 310px here) a card-rating
         * strip would be downscaled ~3.5x and its labels would land near 4px,
         * which is texture, not evidence. Each one repeats the ordinal the rail
         * already prints, so the band belongs to a step rather than to the page.
         *
         * Below md neither strip renders: at 390px it would be 358px wide, a
         * third of the capture, and the labels would be unreadable. On a phone
         * the section is the spine alone, which is what it was designed around.
         */}
        <div className="mt-10 hidden md:mt-14 md:block">
          {proofs.map(({ step, titleKey, shot, altKey }) => (
            <div key={shot} className="mt-10 first:mt-0">
              <p className="font-mono text-xs tracking-[0.08em] text-primary uppercase">
                {t('step_label', { number: step })} · {t(titleKey)}
              </p>
              <ProductShot
                shot={shot}
                alt={t(altKey)}
                sizes="(min-width: 1280px) 1056px, calc(100vw - 4rem)"
                className="mt-3"
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
