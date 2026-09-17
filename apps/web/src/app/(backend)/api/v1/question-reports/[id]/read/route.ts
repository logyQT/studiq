import { questionReportController } from '@studiq/server/controllers/question-report.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(req, async (ctx) => {
    const { id } = await params;
    return toNextResponse(await questionReportController.markRead(id, ctx));
  });
}
