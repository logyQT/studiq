import { permissionsController } from '@studiq/server/controllers/permissions.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

export function GET(req: NextRequest) {
  return withAuth(req, (ctx) =>
    Promise.resolve(toNextResponse(permissionsController.listMyPermissions(ctx))),
  );
}
