import { AppError } from '@/lib/errors';
import type { RequestContext } from '@/lib/request-context';
import { planResolver } from '@/server/services';
import type { FeatureKey } from '@/server/services/plan.resolver';

export { FEATURES, type FeatureKey } from '@/server/services/plan.resolver';

export async function getEnabledFeatures(ctx: RequestContext): Promise<FeatureKey[]> {
  return planResolver.getEnabledFeatures(ctx);
}

export async function requireFeature(ctx: RequestContext, key: FeatureKey): Promise<void> {
  const result = await planResolver.requireFeature(ctx, key);
  if (!result.success) throw new AppError(result.error);
}
