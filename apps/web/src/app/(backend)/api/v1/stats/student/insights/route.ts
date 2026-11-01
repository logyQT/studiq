import { studentInsightsController } from '@studiq/server/controllers/student-insights.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const { searchParams } = new URL(req.url);
    const query = Object.fromEntries(searchParams);
    return toNextResponse(await studentInsightsController.getInsights(query, ctx));
  });
}
