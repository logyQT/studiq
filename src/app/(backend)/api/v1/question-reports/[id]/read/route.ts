import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { questionReportController } from '@/server/controllers/question-report.controller';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(req, async (ctx) => {
    const { id } = await params;
    return toNextResponse(await questionReportController.markRead(id, ctx));
  });
}
