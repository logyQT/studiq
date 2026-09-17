import { AccountType } from '@studiq/authz';
import { orgRoleController } from '@studiq/server/controllers/org-role.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

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
