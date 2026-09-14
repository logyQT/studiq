import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { authController } from '@/server/controllers';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const response = await authController.login(body);
  return toNextResponse(response);
}
