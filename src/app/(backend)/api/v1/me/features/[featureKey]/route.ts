import { NextRequest } from 'next/server';
import { featureController } from '@/server/controllers';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ featureKey: string }> },
) {
  return withAuth(req, async (ctx) => {
    const { featureKey } = await params;
    return toNextResponse(await featureController.checkFeature(ctx, featureKey));
  });
}
