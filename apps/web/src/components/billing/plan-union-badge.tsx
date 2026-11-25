'use client';

import type { PlanSource } from '@studiq/authz';
import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import { Badge } from '@studiq/ui';
import { useTranslations } from 'next-intl';

/** The catalogue name for a plan key, or `null` when the catalogue lacks it. */
function catalogueName(plans: PlanInfo[] | undefined, key: string): string | null {
  return plans?.find((candidate) => candidate.key === key)?.name ?? null;
}

/**
 * The label `/me/plan`'s union is shown with (ADR-0015 §6.1, D28). One layer is
 * that plan's catalogue name; two or more name every layer with its origin —
 * "Hub (organization) + Pro (personal)" — so a paid personal plan cannot hide
 * under the primary plan's name (`#971`). The union is provenance only: the
 * feature and limit lists below a "your plan" header stay the catalogue row's
 * (phase 3b), never the effective union.
 */
function planUnionLabel(
  plan: PlanInfo,
  plans: PlanInfo[] | undefined,
  originLabel: (origin: PlanSource['origin']) => string,
): string {
  if (plan.sources.length <= 1) {
    return catalogueName(plans, plan.key) ?? plan.name;
  }

  return plan.sources
    .map(
      (source) =>
        `${catalogueName(plans, source.planKey) ?? source.planKey} (${originLabel(source.origin)})`,
    )
    .join(' + ');
}

interface PlanUnionBadgeProps {
  plan: PlanInfo;
  /** The active catalogue; a missing row falls back to the key. */
  plans?: PlanInfo[];
  className?: string;
}

/** The "your plan" badge for `/app|/edu/billing`, `/manage/billing` and `/manage/settings`. */
export function PlanUnionBadge({ plan, plans, className }: PlanUnionBadgeProps) {
  const t = useTranslations('BillingPage');

  return (
    <Badge variant="secondary" className={className} data-slot="plan-union-badge">
      {planUnionLabel(plan, plans, (origin) => t(`origin_${origin}`))}
    </Badge>
  );
}
