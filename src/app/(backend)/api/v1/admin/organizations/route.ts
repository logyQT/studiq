import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { organizationController } from '@/server/controllers';
import { AccountType } from '@/types';

export async function GET(req: NextRequest) {
  return withAuth(
    req,
    async () => {
      return toNextResponse(await organizationController.getAll());
    },
    { allowedAccountTypes: [AccountType.SYS_ADMIN] },
  );
}

export async function POST(req: NextRequest) {
  return withAuth(
    req,
    async (ctx) => {
      const body = await req.json();
      return toNextResponse(await organizationController.create(body, ctx));
    },
    { allowedAccountTypes: [AccountType.SYS_ADMIN] },
  );
}
