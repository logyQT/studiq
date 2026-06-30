import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { authController } from '@/server/controllers';

export async function POST(req: NextRequest) {
  return withAuth(req, async () => {
    const body = await req.json();
    const response = await authController.updatePassword(body);
    return toNextResponse(response);
  });
}
