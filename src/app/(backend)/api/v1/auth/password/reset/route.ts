import { authController } from '@studiq/server/controllers/auth.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import type { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const response = await authController.requestPasswordReset(body);
  return toNextResponse(response);
}
