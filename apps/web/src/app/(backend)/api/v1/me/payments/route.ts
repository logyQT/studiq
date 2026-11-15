import { paymentController } from '@studiq/server/controllers/payment.controller';
import { toNoStoreNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => toNoStoreNextResponse(await paymentController.listMine(ctx)));
}
