'use client';

import { useApiQuery } from '@/hooks/use-api';
import { permissionKeys } from '@/lib/query-keys';

type PermissionsMap = Record<string, string | null>;

export function usePermissions() {
  return useApiQuery<{
    permissions: PermissionsMap;
    features: string[];
  }>({
    queryKey: permissionKeys.me,
    url: '/api/v1/permissions/me',
    staleTime: 5 * 60 * 1000,
  });
}
