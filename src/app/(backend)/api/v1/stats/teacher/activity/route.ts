import { NextRequest } from 'next/server';
import { activityController } from '@/server/controllers/activity.controller';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const { searchParams } = new URL(req.url);
    const query = Object.fromEntries(searchParams);
    return toNextResponse(await activityController.getActivity(ctx, query));
  });
}
