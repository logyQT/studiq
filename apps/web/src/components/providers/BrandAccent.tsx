'use client';

import { useEffect } from 'react';
import { useBranding } from '@/hooks/use-branding';

/**
 * Injects the active org's brand color as CSS custom properties (issue #108).
 *
 * Scoped by design: it sets `--brand-accent` (which defaults to `--primary`
 * in globals.css) plus the derived `--brand-accent-soft` and
 * `--brand-accent-sidebar` tokens. Components opt in explicitly, so an org
 * color tints a chosen set of accents (active nav, sidebar active state)
 * rather than retheming the whole app.
 *
 * Not applied on the server — the org's feature set is only known client-side
 * after `/api/v1/features/me` resolves, so this is effect-driven and renders
 * nothing until branding is confirmed enabled.
 */
export function BrandAccent() {
  const { brandColor, isEnabled } = useBranding();

  useEffect(() => {
    const root = document.documentElement;

    if (isEnabled && brandColor) {
      // Blend into each surface's own base color rather than using the raw
      // brand color flat: keeps text legible over the highlight and stays
      // visible in dark mode, where a raw org color could vanish.
      root.style.setProperty('--brand-accent', brandColor);
      root.style.setProperty(
        '--brand-accent-soft',
        `color-mix(in oklab, ${brandColor} 25%, var(--accent))`,
      );
      root.style.setProperty(
        '--brand-accent-sidebar',
        `color-mix(in oklab, ${brandColor} 25%, var(--sidebar-accent))`,
      );
    } else {
      root.style.removeProperty('--brand-accent');
      root.style.removeProperty('--brand-accent-soft');
      root.style.removeProperty('--brand-accent-sidebar');
    }

    return () => {
      root.style.removeProperty('--brand-accent');
      root.style.removeProperty('--brand-accent-soft');
      root.style.removeProperty('--brand-accent-sidebar');
    };
  }, [isEnabled, brandColor]);

  return null;
}
