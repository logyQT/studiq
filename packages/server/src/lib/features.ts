import type { RequestContext } from '@studiq/authz';
import { AppError } from '@studiq/server/lib/errors';
import type { EntitlementKey, EntitlementResolution } from '@studiq/authz';
import { featureResolver } from '@studiq/server/services/feature.resolver';

export async function resolveFeatures(ctx: RequestContext): Promise<EntitlementResolution> {
  return featureResolver.resolveFeatures(ctx);
}

export async function getEnabledFeatures(ctx: RequestContext): Promise<EntitlementKey[]> {
  return featureResolver.getEnabledFeatures(ctx);
}

export async function requireFeature(ctx: RequestContext, key: EntitlementKey): Promise<void> {
  const result = await featureResolver.requireFeature(ctx, key);
  if (!result.success) throw new AppError(result.error);
}
