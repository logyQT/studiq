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
      // ctx.activeOrgId reflects the active_org_id cookie, which the
      // client controls — with-auth.ts only proves real membership via
      // orgRoleId (populated from a genuine org_members row for this
      // exact org+user; null otherwise). Both checks are required.
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
      return toNextResponse(await organizationController.update(id, body));
    },
    { allowedAccountTypes: [AccountType.MANAGER] },
  );
}
