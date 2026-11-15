'use client';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@studiq/ui';
import { useTranslations } from 'next-intl';
import type { PricingAudience } from '@/app/(frontend)/pricing/_components/pricing-audience';
import { FOCUS_RING } from '@/components/shared/focus-ring';
import { cn } from '@/lib/utils';

/**
 * The question/answer key pairs. The two shared questions come first for both
 * audiences; the rest are the ones only that buyer asks (N-09).
 */
const QUESTIONS: Record<PricingAudience, readonly (readonly [string, string])[]> = {
  individual: [
    ['faq_q1', 'faq_a1'],
    ['faq_q2', 'faq_a2'],
    ['faq_q3', 'faq_a3'],
    ['faq_q_ind_1', 'faq_a_ind_1'],
    ['faq_q_ind_2', 'faq_a_ind_2'],
  ],
  organization: [
    ['faq_q1', 'faq_a1'],
    ['faq_q2', 'faq_a2'],
    ['faq_q_org_1', 'faq_a_org_1'],
    ['faq_q_org_2', 'faq_a_org_2'],
  ],
};

/**
 * The questions a buyer asks before paying, collapsed until asked. Each answer
 * is a fact the repo backs (see the i18n catalogue); none of them promises a
 * trial or a retention window, because checkout has neither (PRODUCT §Gaps).
 */
export function PricingFaq({ audience }: { audience: PricingAudience }) {
  const t = useTranslations('PricingPage');

  return (
    <section className="pb-16 md:pb-20">
      <div className="mx-auto max-w-content px-content">
        <h2 className="font-display text-h2 font-semibold text-balance">{t('faq_title')}</h2>

        {/*
         * `forceMount` keeps every answer in the document, so the text is in the
         * server HTML for search engines and a reader without JavaScript. Radix
         * then leaves the panel mounted, which is why the panel's own
         * `data-state` closes it here: a collapsed answer is `display: none`, so
         * it leaves the layout and the accessibility tree (no four empty `region`
         * landmarks) while its text stays in the HTML.
         */}
        <Accordion type="single" collapsible className="mt-6 border-t border-border">
          {QUESTIONS[audience].map(([question, answer], index) => {
            // The panel's id is ours so the trigger can point at it while it is
            // collapsed: the primitive only writes `aria-controls` on an open item,
            // and these panels are mounted either way.
            const panelId = `faq-panel-${audience}-${index}`;

            return (
              <AccordionItem key={question} value={question} className="border-border">
                <AccordionTrigger
                  aria-controls={panelId}
                  className={cn(
                    // The question is the row: the primitive's header element is the
                    // `h3`, so the outline stays h2 → h3 without nesting a second one.
                    // `py-3.5` keeps the row above the 44px touch floor while the five
                    // collapsed questions fit one phone screen (N-01, N-06).
                    'items-center gap-6 rounded-control py-3.5 text-left text-h3 font-semibold hover:no-underline',
                    FOCUS_RING,
                  )}
                >
                  {t(question)}
                </AccordionTrigger>
                <AccordionContent
                  id={panelId}
                  forceMount
                  className="max-w-xl text-sm text-muted-foreground data-[state=closed]:hidden"
                >
                  {t(answer)}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </div>
    </section>
  );
}
