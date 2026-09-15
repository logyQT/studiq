import { AccountType } from '@studiq/authz';
import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { planLimitController } from '@/server/controllers/plan-limit.controller';

export async function GET(req: NextRequest) {
  return withAuth(
    req,
    async () => {
      const planKey = req.nextUrl.searchParams.get('planKey') ?? undefined;
      const response = await planLimitController.getAll(planKey);
      return toNextResponse(response);
    },
    { allowedAccountTypes: [AccountType.SYS_ADMIN] },
  );
}

export async function POST(req: NextRequest) {
  return withAuth(
    req,
    async () => {
      const body = await req.json();
      const response = await planLimitController.create(body);
      return toNextResponse(response);
    },
    { allowedAccountTypes: [AccountType.SYS_ADMIN] },
  );
}
