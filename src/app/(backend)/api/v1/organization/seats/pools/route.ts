import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { seatController } from '@/server/controllers';
import { AccountType } from '@/types';

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
