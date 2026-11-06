import type * as React from 'react';
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Inline style carrying CSS custom properties.
 *
 * React's `CSSProperties` has no index signature for `--*` keys, so the values
 * are widened through a template-literal record and spread instead of asserted.
 */
export function cssVars(
  vars: Record<`--${string}`, string | number | undefined>,
): React.CSSProperties {
  return { ...vars };
}
