import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import type { PricingTranslator } from '@/lib/pricing-features';

/**
 * The plan's own copy: the description and the note. Both plan surfaces print
 * them, and `has` is the guard — the catalogue's `description` column is
 * admin-internal, so a missing message prints no line instead of a raw key.
 */
export function planCopy(
  t: PricingTranslator,
  plan: Pick<PlanInfo, 'key'>,
): { description: string | null; note: string | null } {
  const descKey = `plan_${plan.key}_desc`;
  const noteKey = `plan_${plan.key}_note`;

  return {
    description: t.has(descKey) ? t(descKey) : null,
    note: t.has(noteKey) ? t(noteKey) : null,
  };
}
