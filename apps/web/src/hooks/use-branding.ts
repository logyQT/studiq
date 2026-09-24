'use client';

import { useFeature } from '@/hooks/use-feature';
import { useOrgs } from '@/hooks/use-orgs';

export interface Branding {
  /** Org logo URL, or null when branding is disabled / unset. */
  logoUrl: string | null;
  /** Org brand color (`#rrggbb`), or null when branding is disabled / unset. */
  brandColor: string | null;
  /** True when the org's plan entitles it to custom branding AND a value exists. */
  isEnabled: boolean;
}

const DEFAULT_BRANDING: Branding = { logoUrl: null, brandColor: null, isEnabled: false };

/**
 * Org branding (issue #108), gated by the `branding` feature flag.
 *
 * Returns nulls whenever the feature is off, so a stale logo_url/brand_color
 * sitting in the organizations row can never leak into the UI for a plan that
 * no longer pays for it — the gate lives here rather than at each call site.
 */
export function useBranding(): Branding {
  const featureEnabled = useFeature()('branding');
  const { activeOrg } = useOrgs();

  if (!featureEnabled || !activeOrg) return DEFAULT_BRANDING;

  return {
    logoUrl: activeOrg.logo_url ?? null,
    brandColor: activeOrg.brand_color ?? null,
    isEnabled: true,
  };
}
