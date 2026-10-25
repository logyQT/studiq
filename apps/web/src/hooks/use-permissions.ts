'use client';

import { useAuth } from '@/components/providers/AuthProvider';
import { useApiQuery } from '@/hooks/use-api';
import { permissionKeys } from '@/lib/query-keys';

type PermissionsMap = Record<string, string | null>;

export function usePermissions() {
  const { user } = useAuth();

  return useApiQuery<{
    permissions: PermissionsMap;
  }>({
    queryKey: permissionKeys.me,
    url: '/api/v1/permissions/me',
    staleTime: 5 * 60 * 1000,
    // Permission scopes are resolved per user/active org — same pre-auth 401
    // trap as `useFeatures` (#458).
    enabled: !!user,
  });
}
