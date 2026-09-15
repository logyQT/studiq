import { AccountType } from '@studiq/authz';
import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { seatController } from '@/server/controllers/seat.controller';

export async function GET(req: NextRequest) {
  return withAuth(
    req,
    async (ctx) => {
      return toNextResponse(await seatController.listAssignments(ctx));
    },
    { allowedAccountTypes: [AccountType.MANAGER] },
  );
}

export async function POST(req: NextRequest) {
  return withAuth(
    req,
    async (ctx) => {
      const body = await req.json();
      return toNextResponse(await seatController.assignSeat(ctx, body));
    },
    { allowedAccountTypes: [AccountType.MANAGER] },
  );
}
