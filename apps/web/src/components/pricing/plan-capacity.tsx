'use client';

import { useLocale, useTranslations } from 'next-intl';

/**
 * The organization plan's two capacity facts. A personal plan carries neither
 * limit, so the caller renders this only for `scope: 'organization'`; the seats
 * and groups are what separates the four organization tiers before the feature
 * list does. A value the catalogue does not set prints nothing — the matrix
 * always carries both, and an invented `— uczniów` reads as a rendering fault.
 */
export function PlanCapacity({ limits }: { limits: Record<string, number> }) {
  const t = useTranslations('PricingPage');
  const locale = useLocale();
  const format = (value: number) => new Intl.NumberFormat(locale).format(value);

  const rows = [
    { key: 'capacity_students', value: limits.max_students },
    { key: 'capacity_groups', value: limits.max_groups },
  ].flatMap(({ key, value }) => (value && value > 0 ? [t(key, { count: format(value) })] : []));

  if (rows.length === 0) return null;

  /*
   * Plain text rows, not a nested list: `PlanRow` is itself the `<li>` of the
   * price list, and a `<ul>` here adds two items per plan row to any
   * `ul > li` count. The facts are still one line each, as they were.
   */
  return (
    <div className="space-y-1 text-sm">
      {rows.map((row) => (
        <p key={row}>{row}</p>
      ))}
    </div>
  );
}
