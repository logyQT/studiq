import { Check, GraduationCap } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { FlashcardReviewPreview } from '@/components/marketing/previews/flashcard-review-preview';
import { cn } from '@/lib/utils';

/*
 * The strings are the landing page's free-tier ledger (`LandingPage.free_*`). The
 * row set is not: `components/marketing/features.tsx` lists the same four rows and
 * `pricing.tsx` names them again in `freeRows`, so adding, dropping or reordering a
 * row has to happen in all three places, or this panel promises a plan the landing
 * band no longer sells.
 */
const FREE_FEATURES = [
  { titleKey: 'free_questions', descKey: 'free_questions_desc' },
  { titleKey: 'free_flashcards', descKey: 'free_flashcards_desc' },
  { titleKey: 'free_quizzes', descKey: 'free_quizzes_desc' },
  { titleKey: 'free_stats', descKey: 'free_stats_desc' },
] as const;

/*
 * `FOCUS_RING` is cobalt, which is invisible on the cobalt panel it would sit on.
 * DESIGN reserves `signal` for a focus ring inside a cobalt region; in dark mode
 * the panel's fill is the light cobalt, where lime measures 2.1:1, so the ring
 * takes the panel's own foreground there.
 */
const PANEL_FOCUS =
  'focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 focus-visible:ring-offset-primary focus-visible:outline-none dark:focus-visible:ring-primary-foreground';

/**
 * The sign-up page's benefit panel. `text-primary-foreground` is paper on cobalt in
 * light and ink on cobalt in dark, so the panel reads in both modes without a
 * second set of rules.
 *
 * It carries the page's one surface as well as its copy. The specimen is the
 * product's own flashcard at the card's own height, entering from the bottom-right
 * corner and cut by the panel's edge: `overflow-hidden` plus the negative right
 * offset crop it, and the box stops below the card's face so the reveal hint and
 * the four rating buttons are out of frame. That crop is the reason it can be
 * `inert` — a panel that cannot be tabbed into (NFR-05 pins the wordmark, the
 * sign-in exit and `#name` as the first three stops) may only show the part of the
 * surface that has no behaviour. A "click to reveal" line over a card that cannot
 * be clicked is a false affordance, not a preview.
 */
export function FreeIncluded() {
  const t = useTranslations('RegisterPage');
  const tLanding = useTranslations('LandingPage');

  return (
    <div className="relative flex flex-col overflow-hidden bg-primary p-content text-primary-foreground lg:p-12">
      {/* No `useBranding` here: this page has no active org, so the wordmark is the product's. */}
      <Link
        href="/"
        className={cn(
          'inline-flex h-9 w-fit items-center gap-2 rounded-control text-xl font-bold tracking-tight transition-opacity hover:opacity-80',
          PANEL_FOCUS,
        )}
      >
        <GraduationCap aria-hidden className="size-6" />
        StudiQ
      </Link>

      {/*
       * `max-w-xl` keeps the lede inside a readable measure: the panel is half the
       * viewport, and at 1440 a full-width paragraph would run past 66ch.
       *
       * Phones drop the lede and start the block 24px under the mark instead of 48:
       * at 375×667 the full panel pushed the first input of the stacked column to
       * y=782, so no form control was in the first paint. Both paragraphs return at
       * `sm`.
       */}
      <div className="mt-6 max-w-xl sm:mt-12">
        <p className="font-mono text-xs tracking-[0.08em] uppercase">{t('aside_eyebrow')}</p>
        {/*
         * The accent's one appearance on this page: a 2px rule under the word the
         * claim turns on, in the panel's own foreground weight of emphasis rather
         * than a wash. DESIGN.md §Dosage carries the measurement in both themes.
         */}
        <h1 className="mt-3 font-display text-h2 font-semibold text-balance">
          {t('aside_title_lead')}{' '}
          <span className="underline decoration-signal decoration-2 underline-offset-4 contrast-more:decoration-current">
            {t('aside_title_mark')}
          </span>
        </h1>
        <p className="mt-4 hidden max-w-md text-lede text-pretty sm:block">{t('aside_lede')}</p>
      </div>

      {/*
       * The ledger sits on the panel's floor from `xl`, where the specimen takes the
       * right of the same band, and spans the column below it, where there is no
       * specimen to share the width with. Its descriptions survive only in that
       * middle range: they are what keeps a full-width panel from reading as a list
       * of four headings, and beside the card they would be the second competing
       * list this composition exists to avoid. The width at `xl` is the longest
       * row's measured text (232px, English) plus its mark and gap.
       */}
      <div className="mt-8 xl:mt-auto xl:w-[17rem]">
        <ul className="border-t border-primary-foreground/25">
          {FREE_FEATURES.map(({ titleKey, descKey }) => (
            <li key={titleKey} className="flex gap-3 border-b border-primary-foreground/25 py-2">
              {/*
               * Decorative, so it takes the panel's own foreground at reduced
               * emphasis: the row title is the fact, and `signal` is the h1's
               * underline alone.
               */}
              <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-primary-foreground/70" />
              <div>
                <p className="font-semibold">{tLanding(titleKey)}</p>
                {/*
                 * Visible from `sm` to below `xl`, hidden outside that window. Two
                 * media blocks with no base display class rather than `hidden
                 * sm:block xl:hidden`, so no two display rules can be resolved by
                 * stylesheet order.
                 */}
                <p className="mt-1 text-sm max-sm:hidden xl:hidden">{tLanding(descKey)}</p>
              </div>
            </li>
          ))}
        </ul>

        <p className="mt-6 hidden font-mono text-xs tracking-[0.08em] uppercase sm:block">
          {tLanding('free_point_card')}
        </p>
      </div>

      {/*
       * `text-foreground` is load-bearing: the card's faces inherit their colour, so
       * without it the panel's paper-on-cobalt would land on the card's own paper
       * surface and the question would render at 1:1.
       *
       * `inert` plus `pointer-events-none` is what makes the specimen decorative:
       * no tab stop, nothing announced twice by a screen reader, and a cursor that
       * does not promise a flip the panel does not wire up.
       */}
      <div
        inert
        className="pointer-events-none absolute -right-6 bottom-0 hidden h-[38svh] max-h-[21.25rem] w-[19rem] overflow-hidden text-foreground xl:block"
      >
        <FlashcardReviewPreview cardHeight="[&_fieldset]:h-88" />
      </div>
    </div>
  );
}
