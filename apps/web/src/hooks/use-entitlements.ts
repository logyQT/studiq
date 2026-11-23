'use client';

import type { EntitlementKey, PlanSource } from '@studiq/authz';
import { useAuth } from '@/components/providers/AuthProvider';
import { useApiQuery } from '@/hooks/use-api';
import { useOrgs } from '@/hooks/use-orgs';
import { entitlementKeys } from '@/lib/query-keys';

export interface EntitlementsPayload {
  /** The org the set was resolved for; `null` is the personal layer. */
  orgId: string | null;
  entitlements: EntitlementKey[];
  /** Every catalog limit key; the resolver answers `0` for a missing row. */
  limits: Record<string, number>;
  plan: { primary: string; sources: PlanSource[] };
}

export function useEntitlements() {
  const { user } = useAuth();
  const { activeOrg, isPending: orgsPending } = useOrgs();

  return useApiQuery<EntitlementsPayload>({
    // Partitioned by org, so a switch cannot render the previous set (#1125).
    queryKey: entitlementKeys.org(activeOrg?.id),
    url: '/api/v1/me/entitlements',
    // Batch 7: a change made elsewhere refetches on focus within 60 s.
    staleTime: 60_000,
    // The `active_org_id` cookie is `useOrgs()`'s to establish; waiting for it
    // also keeps the pre-auth shell from caching a 401 (#458).
    enabled: !!user && !orgsPending,
  });
}
