'use client';

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';

export function useFeature(featureKey: string): { hasAccess: boolean; isLoading: boolean } {
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['feature', featureKey],
    queryFn: async () => {
      const res = await apiGet<{ hasAccess: boolean }>(`/api/v1/me/features/${featureKey}`);
      return res.hasAccess;
    },
    enabled: !!user,
    staleTime: 60 * 1000,
  });

  return { hasAccess: data ?? false, isLoading };
}
