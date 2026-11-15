'use client';

import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import { useLocale, useTranslations } from 'next-intl';
import { ComparisonCell } from '@/components/marketing/comparison-cell';
import { FOCUS_RING } from '@/components/shared/focus-ring';
import { getFeatureLabel } from '@/lib/pricing-features';
import {
  formatLimitValue,
  shortPlanName,
  splitFeatureRows,
  splitLimitRows,
} from '@/lib/pricing-ladders';
import { getLimitLabel } from '@/lib/pricing-limits';
import { cn } from '@/lib/utils';

/** One ladder per audience; the caption names which one the table compares. */
export type PricingLadderKind = 'student' | 'educator' | 'organization';

interface ComparisonTableProps {
  plans: PlanInfo[];
  kind: PricingLadderKind;
}

/**
 * The differences between one ladder's plans, and nothing else. A feature every
 * plan carries is printed once above the table and a limit whose value is the
 * same everywhere is not a row, so no fact appears twice (N-06).
 *
 * Four value columns fit a 320px phone, so the table is the whole comparison
 * rather than a window onto one. The region is still focusable: a future fifth
 * plan would overflow it, and a truncated reading has to stay navigable (N-02).
 */
export function ComparisonTable({ plans, kind }: ComparisonTableProps) {
  const t = useTranslations('PricingPage');
  const locale = useLocale();

  const { common, differing } = splitFeatureRows(plans);
  const limits = splitLimitRows(plans);

  const caption = t(`comparison_caption_${kind}`);
  const yesLabel = t('comparison_yes');
  const noLabel = t('comparison_no');
  const included = new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(
    common.map((feature) => getFeatureLabel(feature, t)),
  );

  return (
    <div className="mt-12 md:mt-16">
      <h3 className="text-h3 font-semibold">{t('comparison_title')}</h3>
      {common.length > 0 ? (
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          {t('comparison_all_include', { features: included })}
        </p>
      ) : null}

      {/*
       * A `<section>` with a name *is* the region role, which is why this is not
       * a div carrying one. It is focusable because it scrolls: a fifth plan
       * would overflow, and the region is what a keyboard reader moves sideways
       * with (WCAG 2.1.1).
       */}
      <section
        aria-label={caption}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scroll container is keyboard-operable only when it can take focus.
        tabIndex={0}
        className={cn('mt-6 overflow-x-auto', FOCUS_RING)}
      >
        <table className="w-full text-xs md:text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-border">
              <th
                scope="col"
                className="w-full py-2 pr-2 text-left font-normal text-muted-foreground"
              >
                {t('comparison_feature')}
              </th>
              {plans.map((plan) => (
                <th
                  key={plan.key}
                  scope="col"
                  className="px-1 py-2 text-center font-semibold whitespace-nowrap"
                >
                  {shortPlanName(plan.name)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {differing.map((feature) => (
              <tr key={feature} className="border-b border-border">
                <th scope="row" className="py-2 pr-2 text-left font-normal">
                  {getFeatureLabel(feature, t)}
                </th>
                {plans.map((plan) => (
                  <ComparisonCell
                    key={plan.key}
                    included={plan.features.includes(feature)}
                    yesLabel={yesLabel}
                    noLabel={noLabel}
                    checkClassName="text-primary"
                    className="px-1 py-2"
                  />
                ))}
              </tr>
            ))}
            {limits.map((limit) => (
              <tr key={limit} className="border-b border-border">
                <th scope="row" className="py-2 pr-2 text-left font-normal">
                  {getLimitLabel(limit, t)}
                </th>
                {plans.map((plan) => {
                  const value = plan.limits[limit];
                  // A printed glyph is not a spoken one: "∞" reads as "infinity",
                  // and a dash says nothing about a missing allowance.
                  const spoken =
                    value === undefined || value === 0
                      ? noLabel
                      : value < 0
                        ? t('limit_unlimited')
                        : null;
                  return (
                    <td
                      key={plan.key}
                      className="px-1 py-2 text-center tabular-nums whitespace-nowrap"
                    >
                      <span aria-hidden={spoken ? true : undefined}>{formatLimitValue(value)}</span>
                      {spoken ? <span className="sr-only">{spoken}</span> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
