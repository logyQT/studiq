import { GraduationCap } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
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
 * The panel is type only: the ledger below the statement is the panel's object,
 * and it is the landing page's ledger (`components/marketing/features.tsx`) in the
 * same idiom — a 40px rail holding a mono tabular ordinal, the term at `text-h3`,
 * the description under it. From `lg` the statement takes the panel's spare height
 * on both sides, so a tall panel distributes it around the statement instead of
 * leaving one void between a headline and a ledger pinned to the floor.
 */
export function FreeIncluded() {
  const t = useTranslations('RegisterPage');
  const tLanding = useTranslations('LandingPage');

  return (
    <div className="flex flex-col bg-primary p-content text-primary-foreground lg:p-12">
      {/* No `useBranding` here: this page has no active org, so the wordmark is the product's. */}
      <Link
        href="/"
        className={cn(
          'mb-6 inline-flex h-9 w-fit items-center gap-2 rounded-control text-xl font-bold tracking-tight transition-opacity hover:opacity-80',
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
       * at 375×667 the full panel pushed the first input of the stacked column below
       * the fold, and `#name` is 108px above it today. Both paragraphs return at `sm`.
       *
       * `lg:my-auto` is the panel's vertical distribution, and the wordmark's `mb-6`
       * is its floor: at 1024×768 the content is within 11px of the panel's height,
       * so an auto margin resolving to zero would set the eyebrow against the
       * wordmark.
       */}
      <div className="max-w-xl sm:mt-6 lg:my-auto">
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
       * A term/description list rather than four headings, so the four rows read as
       * a spec sheet. The ordinal is decorative scaffolding for the same reason the
       * landing's is: four hairline rows need a column for the eye to land on, and
       * the number carries no rank.
       */}
      <dl className="mt-6 border-t border-primary-foreground/25">
        {FREE_FEATURES.map(({ titleKey, descKey }, index) => (
          <div key={titleKey} className="border-b border-primary-foreground/25 py-2 pl-10 sm:py-4">
            <dt className="relative text-h3 font-semibold">
              <span
                aria-hidden="true"
                className="absolute -left-10 top-1 font-mono text-xs tabular-nums text-primary-foreground/80"
              >
                {String(index + 1).padStart(2, '0')}
              </span>
              {tLanding(titleKey)}
            </dt>
            {/*
             * Phones keep the terms only: the four descriptions add ~190px to a
             * panel that has 108px of slack above `#name` at 375×667.
             */}
            <dd className="mt-1 text-sm leading-snug max-sm:hidden">{tLanding(descKey)}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-6 hidden font-mono text-xs tracking-[0.08em] uppercase sm:block">
        {tLanding('free_point_card')}
      </p>
    </div>
  );
}
