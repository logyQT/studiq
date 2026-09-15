'use client';

import { useCallback } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { useFeatures } from '@/hooks/use-features';
import { useOrgs } from '@/hooks/use-orgs';
import { usePermissions } from '@/hooks/use-permissions';
import { evaluate } from '@/lib/authz';
import type { PermissionScope } from '@/lib/permissions';

export type CanArg = {
  permissions?: string[];
  features?: string[];
  createdBy?: string;
  orgId?: string;
};

export function useCan() {
  const { user } = useAuth();
  const { activeOrg } = useOrgs();
  const { data } = usePermissions();
  const { data: featureData } = useFeatures();

  const pm = data?.permissions as Record<string, PermissionScope | null> | undefined;
  const enabledFeatures = featureData?.features;

  return useCallback(
    ({ permissions, features, createdBy, orgId }: CanArg): boolean => {
      if (!user) return false;

      if (features?.length) {
        if (!enabledFeatures) return false;
        if (!features.every((f) => enabledFeatures.includes(f))) return false;
      }

      if (permissions && permissions.length > 0) {
        if (!pm) return false;
        return permissions.every((p) => {
          const scope = pm[p];
          if (!scope) return false;
          return evaluate({
            scope,
            userId: user.id,
            resource: {
              createdBy: createdBy ?? '',
              orgId: orgId ?? null,
              activeOrgId: activeOrg?.id ?? null,
            },
          });
        });
      }

      return true;
    },
    [pm, enabledFeatures, user, activeOrg?.id],
  );
}
