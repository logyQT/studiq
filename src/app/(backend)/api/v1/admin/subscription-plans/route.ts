import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { subscriptionPlanAdminController } from '@/server/controllers/subscription-plan-admin.controller';

import { AccountType } from '@/types';

export async function GET(req: NextRequest) {
  return withAuth(
    req,
    async () => {
      const response = await subscriptionPlanAdminController.getAll();
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
      const response = await subscriptionPlanAdminController.create(body);
      return toNextResponse(response);
    },
    { allowedAccountTypes: [AccountType.SYS_ADMIN] },
  );
}
