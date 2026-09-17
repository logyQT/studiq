'use client';

import { useApiQuery } from '@/hooks/use-api';
import { featureKeys } from '@/lib/query-keys';

export type FeatureRolloutMap = Partial<Record<string, number>>;

export function useFeatures() {
  return useApiQuery<{
    features: string[];
    rollout: FeatureRolloutMap;
  }>({
    queryKey: featureKeys.me,
    url: '/api/v1/features/me',
    staleTime: 5 * 60 * 1000,
  });
}
