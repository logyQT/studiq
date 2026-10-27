import { authController } from '@studiq/server/controllers/auth.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withPublicTracing } from '@studiq/server/lib/with-public-tracing';
import type { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  return withPublicTracing(req, async () => {
    const body = await req.json();
    return toNextResponse(await authController.requestPasswordReset(body));
  });
}
