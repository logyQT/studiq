'use client';

import type { PermissionScope } from '@studiq/authz';
import { useAuth } from '@/components/providers/AuthProvider';
import { useApiQuery } from '@/hooks/use-api';
import { useOrgs } from '@/hooks/use-orgs';
import { permissionKeys } from '@/lib/query-keys';

type PermissionsMap = Record<string, PermissionScope | null>;

export interface PermissionsPayload {
  /** The org the map was resolved for; `null` is the personal layer. */
  orgId: string | null;
  permissions: PermissionsMap;
}

/** How long an authority answer stays fresh before a focus refetch may replace it. */
const AUTHORITY_STALE_MS = 60_000;

export function usePermissions() {
  const { user } = useAuth();
  const { activeOrg, isPending: orgsPending } = useOrgs();
  const orgId = activeOrg?.id ?? null;

  return useApiQuery<PermissionsPayload>({
    // Same partitioning rule as `useEntitlements`: the scope map is the active
    // org's role, so it is cached per org (#1125, ADR-0015 §7.1).
    queryKey: permissionKeys.org(orgId),
    url: '/api/v1/me/permissions',
    staleTime: AUTHORITY_STALE_MS,
    refetchOnWindowFocus: true,
    // Resolved per user/active org, and only once `useOrgs()` has settled — the
    // same pre-auth 401 trap as `useEntitlements` (#458).
    enabled: !!user && !orgsPending,
  });
}
