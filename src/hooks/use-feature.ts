'use client';

import { usePermissions } from '@/hooks/use-permissions';

export function useFeature(featureKey: string): { hasAccess: boolean; isLoading: boolean } {
  const { data, isLoading } = usePermissions();

  return {
    hasAccess: data?.features?.includes(featureKey) ?? false,
    isLoading,
  };
}
