import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { activityController } from '@/server/controllers/activity.controller';

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const { searchParams } = new URL(req.url);
    const query = Object.fromEntries(searchParams);
    return toNextResponse(await activityController.getActivity(ctx, query));
  });
}
