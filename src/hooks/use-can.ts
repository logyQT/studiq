'use client';

import { useCallback } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { useOrgs } from '@/hooks/use-orgs';
import { usePermissions } from '@/hooks/use-permissions';
import { evaluate } from '@/lib/authz';
import type { PermissionScope } from '@/lib/permissions';

export function useCan() {
  const { user } = useAuth();
  const { activeOrg } = useOrgs();
  const { data } = usePermissions();

  const permissions = data?.permissions as Record<string, PermissionScope | null> | undefined;

  return useCallback(
    (permission: string, createdBy?: string, resourceOrgId?: string): boolean => {
      if (!permissions || !user) return false;
      const scope = permissions[permission];
      if (!scope) return false;

      return evaluate({
        scope,
        userId: user.id,
        resource: {
          createdBy: createdBy ?? '',
          orgId: resourceOrgId ?? null,
          activeOrgId: activeOrg?.id ?? null,
        },
      });
    },
    [permissions, user, activeOrg?.id],
  );
}
