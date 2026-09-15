import { AppError } from '@/lib/errors';
import type { RequestContext } from '@/lib/request-context';
import { featureResolver } from '@/server/services';
import type { FeatureKey, FeatureResolution } from '@/server/services/feature.resolver';

export { FEATURES, type FeatureKey, isFeatureKey } from '@/server/services/feature.resolver';

export async function resolveFeatures(ctx: RequestContext): Promise<FeatureResolution> {
  return featureResolver.resolveFeatures(ctx);
}

export async function getEnabledFeatures(ctx: RequestContext): Promise<FeatureKey[]> {
  return featureResolver.getEnabledFeatures(ctx);
}

export async function requireFeature(ctx: RequestContext, key: FeatureKey): Promise<void> {
  const result = await featureResolver.requireFeature(ctx, key);
  if (!result.success) throw new AppError(result.error);
}
