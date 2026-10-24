import { AccountType } from '@studiq/authz';
import { organizationController } from '@studiq/server/controllers/organization.controller';
import { AppError } from '@studiq/server/lib/errors';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(
    req,
    async (ctx) => {
      const { id } = await params;
      // with-auth.ts only sets ctx.activeOrgId (and ctx.orgRoleId) when a
      // real org_members row exists for this exact org+user, so a forged
      // active_org_id cookie cannot reach here. Both checks are kept as
      // defence in depth.
      if (id !== ctx.activeOrgId || !ctx.orgRoleId) throw new AppError('FORBIDDEN');
      return toNextResponse(await organizationController.getById(id));
    },
    { allowedAccountTypes: [AccountType.EDUCATOR, AccountType.MANAGER] },
  );
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(
    req,
    async (ctx) => {
      const { id } = await params;
      if (id !== ctx.activeOrgId || !ctx.orgRoleId) throw new AppError('FORBIDDEN');
      const body = await req.json();
      return toNextResponse(await organizationController.update(ctx, id, body));
    },
    { allowedAccountTypes: [AccountType.MANAGER] },
  );
}
