'use client';

import { useCallback } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { useOrgs } from '@/hooks/use-orgs';
import { usePermissions } from '@/hooks/use-permissions';
import { evaluateScope, type PermissionScope } from '@/lib/permissions';

export type PermissionResource = {
  createdBy?: string;
  orgId?: string;
};

/**
 * Permission gating for the client. `usePermission()` returns a checker for
 * a single permission name (e.g. `permission('deck.update', { createdBy })`)
 * backed by the `/api/v1/permissions/me` scope map. Scoped evaluations
 * (own/org/group) resolve against the active org context.
 */
export function usePermission() {
  const { user } = useAuth();
  const { activeOrg } = useOrgs();
  const { data } = usePermissions();

  const pm = data?.permissions as Record<string, PermissionScope | null> | undefined;

  return useCallback(
    (permission: string, resource?: PermissionResource): boolean => {
      if (!user || !pm) return false;
      const scope = pm[permission];
      if (!scope) return false;
      return evaluateScope(scope, user.id, {
        createdBy: resource?.createdBy ?? '',
        orgId: resource?.orgId ?? null,
        activeOrgId: activeOrg?.id ?? null,
      });
    },
    [pm, user, activeOrg?.id],
  );
}
