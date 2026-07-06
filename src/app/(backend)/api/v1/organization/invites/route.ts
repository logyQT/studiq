import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { invitationController } from '@/server/controllers';
import { AccountType } from '@/types';

export async function POST(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const body = await req.json();
    return toNextResponse(await invitationController.create(ctx, body));
  });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');

  // ?token=xxx → getByToken (public)
  if (token) {
    const response = await invitationController.getByToken(token);
    return toNextResponse(response);
  }

  // No token → list invitations (authenticated, manager/educator only)
  return withAuth(
    req,
    async (ctx) => {
      const isAccepted = searchParams.get('isAccepted') === 'true';
      return toNextResponse(await invitationController.list(ctx, { isAccepted }));
    },
    { allowedAccountTypes: [AccountType.EDUCATOR, AccountType.MANAGER] },
  );
}
