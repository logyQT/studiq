import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { featuresController } from '@/server/controllers/features.controller';

import type { FeatureKey } from '@/server/services/feature.resolver';

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const result = await featuresController.myFeatures(ctx);
    const response = toNextResponse(result);

    // Surface live rollout gating so clients can show
    // "you're in the pilot / this is rolled out to N%" to users.
    if (result.success && result.data?.rollout) {
      const rollout = result.data.rollout;
      const keys = Object.keys(rollout) as FeatureKey[];
      if (keys.length > 0) {
        const header = keys.map((k) => `${k}=${rollout[k]}`).join(',');
        response.headers.set('X-Feature-Rollout', header);
      }
    }

    return response;
  });
}
