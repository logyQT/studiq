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
export type PricingLadderKind = 'individual' | 'organization';

interface ComparisonTableProps {
  plans: PlanInfo[];
  kind: PricingLadderKind;
}

/**
 * The differences between one ladder's plans, and nothing else. A feature every
 * plan carries is printed once above the table and a limit whose value is the
 * same everywhere is not a row, so no fact appears twice (N-06).
 *
 * Measured at 320px on `/pricing?audience=organization`, the tightest ladder:
 * five columns fill the 288px gutter exactly (label 94px, plans 47/44/50/53px),
 * no cell clips and the region does not scroll. The region is still focusable,
 * because a fifth plan would overflow it and a truncated reading has to stay
 * navigable (N-02).
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
                className="w-full py-2 pr-1 text-left font-normal text-muted-foreground md:pr-3"
              >
                {t('comparison_feature')}
              </th>
              {plans.map((plan) => (
                <th
                  key={plan.key}
                  scope="col"
                  className="min-w-11 px-0.5 py-2 text-center font-semibold whitespace-nowrap md:min-w-16 md:px-2"
                >
                  {shortPlanName(plan.name)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {differing.map((feature) => (
              <tr key={feature} className="border-b border-border">
                <th scope="row" className="py-2 pr-1 text-left font-normal md:pr-3">
                  {getFeatureLabel(feature, t)}
                </th>
                {plans.map((plan) => (
                  <ComparisonCell
                    key={plan.key}
                    included={plan.features.includes(feature)}
                    yesLabel={yesLabel}
                    noLabel={noLabel}
                    checkClassName="text-primary"
                    className="min-w-11 px-0.5 py-2 md:min-w-16 md:px-2"
                  />
                ))}
              </tr>
            ))}
            {limits.map((limit) => (
              <tr key={limit} className="border-b border-border">
                <th scope="row" className="py-2 pr-1 text-left font-normal md:pr-3">
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
                      className="min-w-11 px-0.5 py-2 text-center tabular-nums whitespace-nowrap md:min-w-16 md:px-2"
                    >
                      <span aria-hidden={spoken ? true : undefined}>
                        {formatLimitValue(value, locale)}
                      </span>
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
