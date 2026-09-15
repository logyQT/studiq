import { AccountType } from '@studiq/authz';
import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { planFeatureController } from '@/server/controllers/plan-feature.controller';

export async function GET(_req: NextRequest) {
  return withAuth(
    _req,
    async () => {
      const response = await planFeatureController.getAll();
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
      const response = await planFeatureController.create(body);
      return toNextResponse(response);
    },
    { allowedAccountTypes: [AccountType.SYS_ADMIN] },
  );
}
