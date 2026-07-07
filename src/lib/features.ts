import { AppError } from '@/lib/errors';
import type { RequestContext } from '@/lib/request-context';
import {
  type FeatureKey,
  getEnabledFeatures as resolveFeatures,
} from '@/server/services/plan.resolver';

export { FEATURES, type FeatureKey } from '@/server/services/plan.resolver';

export async function getEnabledFeatures(ctx: RequestContext): Promise<FeatureKey[]> {
  return resolveFeatures(ctx);
}

export async function requireFeature(ctx: RequestContext, key: FeatureKey): Promise<void> {
  const enabled = await getEnabledFeatures(ctx);
  if (!enabled.includes(key)) {
    throw new AppError('FORBIDDEN');
  }
}
