'use client';

import { useCallback } from 'react';
import { useFeatures } from '@/hooks/use-features';

/**
 * Feature gating for the client. `useFeature()` returns a checker for a
 * single feature key (e.g. `feature('ai.chat')`) backed by the dedicated
 * `/api/v1/features/me` endpoint.
 */
export function useFeature() {
  const { data } = useFeatures();
  const enabledFeatures = data?.features;

  return useCallback((feature: string) => !!enabledFeatures?.includes(feature), [enabledFeatures]);
}
