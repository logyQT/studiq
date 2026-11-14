'use client';

import { useTranslations } from 'next-intl';
import { FlashcardReviewPreview } from '@/components/marketing/previews/flashcard-review-preview';
import { SectionHeader } from '@/components/marketing/ui/section-header';

const freeFeatures = [
  { titleKey: 'free_questions', descKey: 'free_questions_desc' },
  { titleKey: 'free_flashcards', descKey: 'free_flashcards_desc' },
  { titleKey: 'free_quizzes', descKey: 'free_quizzes_desc' },
  { titleKey: 'free_stats', descKey: 'free_stats_desc' },
] as const;

const freePoints = ['free_point_card', 'free_point_commitment', 'free_point_start'] as const;

const aiFeatures = [
  { titleKey: 'ai_generate_questions', descKey: 'ai_generate_questions_desc' },
  { titleKey: 'ai_generate_flashcards', descKey: 'ai_generate_flashcards_desc' },
] as const;

/*
 * Two tiers, two compositions. The free tier is a hairline ledger: one term per
 * row against its description, so the four capabilities read as a spec sheet
 * rather than four equal cards. The paid tier is a 5/6 split with a single
 * anchor statement, because it is one argument with three parts, not three
 * peers. Colour is limited to the two cobalt tier labels: `signal` belongs to
 * actions, and this section has none.
 */
export function Features() {
  const t = useTranslations('LandingPage');

  return (
    <section id="features" className="py-16 md:py-20">
      <div className="mx-auto max-w-content px-content">
        {/*
         * The specimen rides the header band so the ledger below it keeps the
         * full width: the four rows are a spec sheet, and a card wedged between
         * the terms would break their single-line rhythm. No plate, border or
         * shadow around it: the product's card carries its own surface
         * (DESIGN §Product imagery).
         *
         * The split starts at `lg`, like the hero's: at 768 a two-column grid
         * leaves the card a quarter of the page, which turns a landscape card
         * into a portrait one. Below `lg` the card takes the full width instead.
         *
         * The columns are an even 6/6 because the card needs the width and the
         * header does not: the title's longest line is ~449px at 1440, so a
         * five-column header would wrap it while a six-column one leaves it one
         * line, and every column given to the header is one the card loses.
         */}
        <div className="lg:grid lg:grid-cols-12 lg:gap-x-8">
          <div className="lg:col-span-6">
            <SectionHeader
              eyebrow={t('free_badge')}
              title={t('free_title')}
              points={freePoints.map((key) => t(key))}
            />
          </div>
          <div className="mt-10 lg:col-span-6 lg:col-start-7 lg:row-start-1 lg:mt-0">
            <FlashcardReviewPreview />
          </div>
        </div>

        <dl className="mt-10 border-t border-border md:mt-16">
          {freeFeatures.map(({ titleKey, descKey }, index) => (
            <div
              key={titleKey}
              className="relative grid gap-x-8 gap-y-1.5 border-b border-border py-5 pl-10 md:grid-cols-12 md:items-baseline md:gap-y-2 md:py-6 md:pl-0"
            >
              {/*
               * The numbered rail is mobile-only: four hairline rows at phone
               * width read as one paragraph, and the ordinal gives the eye a
               * column to land on while the term keeps its own line.
               */}
              <dt className="relative text-h3 font-semibold md:col-span-5">
                <span
                  aria-hidden="true"
                  className="absolute top-1 -left-10 font-mono text-xs tabular-nums text-primary md:hidden"
                >
                  {String(index + 1).padStart(2, '0')}
                </span>
                {t(titleKey)}
              </dt>
              <dd className="max-w-prose text-sm leading-snug text-muted-foreground md:col-span-6 md:col-start-7 md:leading-relaxed">
                {t(descKey)}
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-12 md:mt-24 md:grid md:grid-cols-12 md:gap-x-8">
          <div className="md:col-span-5">
            <p className="font-mono text-xs tracking-[0.08em] text-primary uppercase">
              {t('ai_badge')}
            </p>
            <h3 className="mt-3 text-h3 font-semibold text-balance">{t('ai_title')}</h3>
            <p className="mt-3 max-w-prose text-sm leading-snug text-muted-foreground md:leading-relaxed">
              {t('ai_desc')}
            </p>
          </div>

          <dl className="mt-8 md:col-span-6 md:col-start-7 md:mt-0">
            {aiFeatures.map(({ titleKey, descKey }, index) => (
              <div
                key={titleKey}
                className="relative border-t border-border py-4 pl-10 first:border-t-0 first:pt-0 md:py-5 md:pl-0"
              >
                <dt className="relative font-semibold">
                  <span
                    aria-hidden="true"
                    className="absolute top-0.5 -left-10 font-mono text-xs tabular-nums text-primary md:hidden"
                  >
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  {t(titleKey)}
                </dt>
                <dd className="mt-1 max-w-prose text-sm leading-snug text-muted-foreground md:leading-relaxed">
                  {t(descKey)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
