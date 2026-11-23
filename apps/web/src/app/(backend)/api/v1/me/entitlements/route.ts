import { entitlementsController } from '@studiq/server/controllers/entitlements.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

export function GET(req: NextRequest) {
  return withAuth(req, async (ctx) =>
    toNextResponse(await entitlementsController.myEntitlements(ctx)),
  );
}
