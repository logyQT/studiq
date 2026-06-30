import { AppError } from '@/lib/errors';
import { featureService } from '@/server/services/feature.service';
import type { RequestContext } from '@/lib/request-context';

export async function requireFeature(ctx: RequestContext, featureKey: string): Promise<void> {
  const hasAccess = await featureService.checkFeatureAccess(ctx, featureKey);
  if (!hasAccess) {
    throw new AppError('FORBIDDEN');
  }
}

export async function checkFeatureAccess(ctx: RequestContext, featureKey: string): Promise<boolean> {
  return featureService.checkFeatureAccess(ctx, featureKey);
}
