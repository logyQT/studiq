import { questionReportController } from '@studiq/server/controllers/question-report.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import { listQuery } from '@studiq/server/lib/query-list';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const query = listQuery(req.nextUrl.searchParams, [
      'q',
      'status',
      'sortBy',
      'sortOrder',
      'cursor',
      'limit',
    ]);
    return toNextResponse(await questionReportController.list(query, ctx));
  });
}
