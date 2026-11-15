import { Check, GraduationCap } from 'lucide-react';
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
       * Phones drop the lede and the closing line and start the block 24px under the
       * mark instead of 48: at 375×667 the full panel pushed the first input of the
       * stacked column to y=782, so no form control was in the first paint. The
       * eyebrow and the four rows still say which plan this is, and both paragraphs
       * return at `sm`.
       */}
      <div className="mt-6 max-w-xl sm:mt-12 lg:my-auto">
        <p className="font-mono text-xs tracking-[0.08em] uppercase">{t('aside_eyebrow')}</p>
        <h1 className="mt-3 font-display text-h2 font-semibold text-balance">{t('aside_title')}</h1>
        <p className="mt-4 hidden text-lede text-pretty sm:block">{t('aside_lede')}</p>

        <ul className="mt-8 border-t border-primary-foreground/25">
          {FREE_FEATURES.map(({ titleKey, descKey }) => (
            <li key={titleKey} className="flex gap-3 border-b border-primary-foreground/25 py-4">
              {/*
               * Decorative, so it takes the panel's own foreground at reduced
               * emphasis: the row title is the fact, and `signal` is reserved for the
               * page's one action (the submit).
               */}
              <Check aria-hidden className="mt-0.5 size-5 shrink-0 text-primary-foreground/70" />
              <div>
                <p className="font-semibold">{tLanding(titleKey)}</p>
                {/* Phones drop the descriptions so the four titles still fit above the form. */}
                <p className="mt-1 hidden text-sm sm:block">{tLanding(descKey)}</p>
              </div>
            </li>
          ))}
        </ul>

        <p className="mt-6 hidden font-mono text-xs tracking-[0.08em] uppercase sm:block">
          {tLanding('free_point_card')}
        </p>
      </div>
    </div>
  );
}
