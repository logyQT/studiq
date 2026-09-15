import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { orgRoleController } from '@/server/controllers/org-role.controller';

import { AccountType } from '@/types';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth(
    req,
    async (ctx) => {
      const body = await req.json();
      return toNextResponse(await orgRoleController.setPermissions(ctx, id, body));
    },
    { allowedAccountTypes: [AccountType.EDUCATOR, AccountType.MANAGER] },
  );
}
