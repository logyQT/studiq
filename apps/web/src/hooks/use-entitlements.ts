'use client';

import type { EntitlementKey, LimitKey, PlanSource } from '@studiq/authz';
import { useAuth } from '@/components/providers/AuthProvider';
import { useApiQuery } from '@/hooks/use-api';
import { useOrgs } from '@/hooks/use-orgs';
import { entitlementKeys } from '@/lib/query-keys';

export interface EntitlementsPayload {
  /** The org the set was resolved for; `null` is the personal layer. */
  orgId: string | null;
  entitlements: EntitlementKey[];
  limits: Record<LimitKey, number>;
  plan: { primary: string; sources: PlanSource[] };
}

/** How long an authority answer stays fresh before a focus refetch may replace it. */
const AUTHORITY_STALE_MS = 60_000;

export function useEntitlements() {
  const { user } = useAuth();
  const { activeOrg, isPending: orgsPending } = useOrgs();
  const orgId = activeOrg?.id ?? null;

  return useApiQuery<EntitlementsPayload>({
    // Partitioned by the org it was resolved for, so a switch can never render
    // the previous org's set under the new one (#1125, ADR-0015 §7.1).
    queryKey: entitlementKeys.org(orgId),
    url: '/api/v1/me/entitlements',
    staleTime: AUTHORITY_STALE_MS,
    refetchOnWindowFocus: true,
    // The payload is resolved from the `active_org_id` cookie, which `useOrgs()`
    // establishes: a request sent before it settles is cookie-less. Waiting for
    // it also keeps the pre-auth shell (`/login` renders `BrandAccent` →
    // `useBranding`) from caching a 401 as the anonymous entry (#458).
    enabled: !!user && !orgsPending,
  });
}
