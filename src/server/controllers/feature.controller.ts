import { featureService } from '@/server/services/feature.service';
import { ControllerResponse } from '@/lib/controller-response';
import { withErrorHandling } from '@/lib/with-error-handling';
import type { RequestContext } from '@/lib/request-context';

export class FeatureController {
  async checkFeature(ctx: RequestContext, featureKey: string): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const hasAccess = await featureService.checkFeatureAccess(ctx, featureKey);
      return { success: true, statusCode: 200, data: { hasAccess } };
    }, ctx);
  }
}

export const featureController = new FeatureController();
