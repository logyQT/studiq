import { questionTransferController } from '@studiq/server/controllers/question-transfer.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

/**
 * `POST /api/v1/questions/banks/:id/import` with `{ questions }`. An unparseable body becomes
 * `null` so the schema answers 422, rather than the route throwing a bare 400.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(req, async (ctx) => {
    const { id } = await params;
    const body = await req.json().catch(() => null);
    return toNextResponse(await questionTransferController.importQuestions(id, body, ctx));
  });
}
