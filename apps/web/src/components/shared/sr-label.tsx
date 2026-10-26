'use client';

import { useTranslations } from 'next-intl';

type SrLabelProps = {
  /** Key in the `A11y` message namespace. */
  k: string;
  /** Placeholder values, e.g. the name of the row the control acts on. */
  values?: Record<string, string | number>;
};

/**
 * Screen-reader-only text for icon-only buttons.
 *
 * A `<Button size="icon">` whose only child is an `aria-hidden` icon has an empty accessible
 * name, so assistive technology announces just "button" (#253). Rendering this inside the
 * button gives it a localized name without touching the surrounding component's translator.
 */
export function SrLabel({ k, values }: SrLabelProps) {
  const t = useTranslations('A11y');
  return <span className="sr-only">{t(k as Parameters<typeof t>[0], values)}</span>;
}
