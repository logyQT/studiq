import { statsController } from '@studiq/server/controllers/stats.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const { searchParams } = req.nextUrl;
    const range = searchParams.get('range') ?? undefined;
    const startDate = searchParams.get('startDate') ?? undefined;
    const endDate = searchParams.get('endDate') ?? undefined;
    return toNextResponse(await statsController.getActivity(ctx, range, startDate, endDate));
  });
}
