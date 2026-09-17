import type { RequestContext } from '@studiq/authz';
import type { ControllerResponse } from '@studiq/server/lib/controller-response';
import { resolveFeatures } from '@studiq/server/lib/features';
import { wrapService } from '@studiq/server/lib/observability';
import type { FeatureKey } from '@studiq/server/services/feature.resolver';

export interface MyFeaturesData {
  features: FeatureKey[];
  rollout: Partial<Record<FeatureKey, number>>;
}

export class FeaturesController {
  async myFeatures(ctx: RequestContext): Promise<ControllerResponse<MyFeaturesData>> {
    const { features, rollout } = await resolveFeatures(ctx);
    return { success: true, statusCode: 200, data: { features, rollout } };
  }
}
export const featuresController = wrapService(new FeaturesController(), 'features.controller');
