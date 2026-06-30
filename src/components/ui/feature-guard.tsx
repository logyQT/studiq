'use client';

import type React from 'react';
import { useFeature } from '@/hooks/use-feature';

interface FeatureGuardProps {
  feature: string;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export function FeatureGuard({ feature, fallback = null, children }: FeatureGuardProps) {
  const { hasAccess, isLoading } = useFeature(feature);

  if (isLoading) return null;
  if (!hasAccess) return <>{fallback}</>;
  return <>{children}</>;
}
