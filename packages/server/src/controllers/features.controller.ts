import type { RequestContext } from '@studiq/authz';
import type { ControllerResponse } from '@studiq/server/lib/controller-response';
import { resolveEntitlements } from '@studiq/server/lib/entitlements';
import { wrapService } from '@studiq/server/lib/observability';
import type { EntitlementKey } from '@studiq/authz';

export interface MyFeaturesData {
  features: EntitlementKey[];
}

export class FeaturesController {
  async myFeatures(ctx: RequestContext): Promise<ControllerResponse<MyFeaturesData>> {
    const { entitlements } = await resolveEntitlements(ctx);
    return { success: true, statusCode: 200, data: { features: entitlements } };
  }
}
export const featuresController = wrapService(new FeaturesController(), 'features.controller');
