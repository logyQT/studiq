import { paymentController } from '@studiq/server/controllers/payment.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const response = toNextResponse(await paymentController.listMine(ctx));
    // The body contains signed hosted invoice URLs: never cache it.
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  });
}
