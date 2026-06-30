import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { invitationController } from '@/server/controllers';

export async function POST(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const body = await req.json();
    return toNextResponse(await invitationController.create(ctx, body));
  });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token') || '';
  const response = await invitationController.getByToken(token);
  return toNextResponse(response);
}
