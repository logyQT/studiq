import { AccountType } from '@studiq/authz';
import { seatController } from '@studiq/server/controllers/seat.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  return withAuth(
    req,
    async (ctx) => {
      return toNextResponse(await seatController.listPools(ctx));
    },
    { allowedAccountTypes: [AccountType.MANAGER] },
  );
}

export async function POST(req: NextRequest) {
  return withAuth(
    req,
    async (ctx) => {
      const body = await req.json();
      return toNextResponse(await seatController.createPool(ctx, body));
    },
    { allowedAccountTypes: [AccountType.MANAGER] },
  );
}
