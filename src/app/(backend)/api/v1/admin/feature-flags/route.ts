import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { featureFlagController } from '@/server/controllers/feature-flag.controller';

import { AccountType } from '@/types';

export async function GET(_req: NextRequest) {
  return withAuth(
    _req,
    async () => {
      const response = await featureFlagController.getAll();
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
      const response = await featureFlagController.create(body);
      return toNextResponse(response);
    },
    { allowedAccountTypes: [AccountType.SYS_ADMIN] },
  );
}
