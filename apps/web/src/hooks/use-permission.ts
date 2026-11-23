'use client';

import { evaluateScope, type PermissionScope } from '@studiq/authz';
import { useCallback } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { useOrgs } from '@/hooks/use-orgs';
import { usePermissions } from '@/hooks/use-permissions';

export type PermissionResource = {
  createdBy?: string;
  orgId?: string;
};

export type PermissionChecker = (permission: string, resource?: PermissionResource) => boolean;

/**
 * The scope `/api/v1/me/permissions` answered for `permission`, or `null` when
 * the map has not resolved yet or does not carry the key (absent means deny).
 * A "can this caller reach this surface at all" gate reads this instead of a
 * scoped evaluation: most keys are granted at `group`/`organization` scope,
 * where `evaluateScope` also needs the resource row to say yes, and a nav entry
 * has no row to ask about.
 */
export function permissionScope(
  permissions: Record<string, PermissionScope | null> | undefined,
  permission: string,
): PermissionScope | null {
  return permissions?.[permission] ?? null;
}

/**
 * Permission gating for the client. `usePermission()` returns a checker for
 * a single permission name (e.g. `permission('deck.update', { createdBy })`)
 * backed by the `/api/v1/me/permissions` scope map. Scoped evaluations
 * (own/org/group) resolve against the active org context.
 *
 * A permission the caller holds at *any* scope passes when no resource is given:
 * that is the same question the server's `resolveScope` answers for a key it
 * has a row for, and it is what a surface a role reaches at `group` scope needs
 * to stay reachable. An unknown key still answers `false`, so a user without
 * the permission never passes.
 */
export function usePermission(): PermissionChecker {
  const { user } = useAuth();
  const { activeOrg } = useOrgs();
  const { data } = usePermissions();

  const pm = data?.permissions;

  return useCallback(
    (permission: string, resource?: PermissionResource): boolean => {
      if (!user) return false;
      const scope = permissionScope(pm, permission);
      if (!scope) return false;
      if (!resource) return true;
      return evaluateScope(scope, user.id, {
        createdBy: resource.createdBy ?? '',
        orgId: resource.orgId ?? null,
        activeOrgId: activeOrg?.id ?? null,
      });
    },
    [pm, user, activeOrg?.id],
  );
}
