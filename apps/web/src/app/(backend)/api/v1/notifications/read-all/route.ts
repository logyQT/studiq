import { notificationController } from '@studiq/server/controllers/notification.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    return toNextResponse(await notificationController.markAllRead(ctx));
  });
}
