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

export function usePermissions() {
  const { user } = useAuth();
  const { activeOrg, isPending: orgsPending } = useOrgs();

  return useApiQuery<PermissionsPayload>({
    // The scope map is the active org's role, so it caches per org (#1125).
    queryKey: permissionKeys.org(activeOrg?.id),
    url: '/api/v1/me/permissions',
    staleTime: 60_000,
    // Same pre-auth 401 trap as `useEntitlements` (#458).
    enabled: !!user && !orgsPending,
  });
}
