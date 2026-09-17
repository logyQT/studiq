import { authController } from '@studiq/server/controllers/auth.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

export async function PUT(req: NextRequest) {
  return withAuth(req, async () => {
    const body = await req.json();
    const response = await authController.updateProfile(body);
    return toNextResponse(response);
  });
}
