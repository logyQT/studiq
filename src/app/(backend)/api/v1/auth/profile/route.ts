import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { authController } from '@/server/controllers/auth.controller';

export async function PUT(req: NextRequest) {
  return withAuth(req, async () => {
    const body = await req.json();
    const response = await authController.updateProfile(body);
    return toNextResponse(response);
  });
}
