'use client';

import { useAuth } from '@/components/providers/AuthProvider';
import { useApiQuery } from '@/hooks/use-api';
import { featureKeys } from '@/lib/query-keys';

export type FeatureRolloutMap = Partial<Record<string, number>>;

export function useFeatures() {
  const { user } = useAuth();

  return useApiQuery<{
    features: string[];
    rollout: FeatureRolloutMap;
  }>({
    queryKey: featureKeys.me,
    url: '/api/v1/features/me',
    staleTime: 5 * 60 * 1000,
    // Feature/rollout data is resolved per user (and per active org), so it can
    // only be fetched once `/api/v1/auth/me` has resolved. Fetching it on the
    // pre-auth shell (`/login` renders `BrandAccent` → `useBranding`) returned a
    // 401 that stayed cached as the anonymous entry for the next identity (#458).
    enabled: !!user,
  });
}
