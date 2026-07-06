import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { organizationMemberController } from '@/server/controllers/organization-member.controller';
import { AccountType } from '@/types';

export async function GET(req: NextRequest) {
  return withAuth(
    req,
    async (ctx) => {
      const { searchParams } = new URL(req.url);
      const roleFilter = searchParams.get('role') || undefined;
      return toNextResponse(await organizationMemberController.listMembers(ctx, roleFilter));
    },
    { allowedAccountTypes: [AccountType.EDUCATOR, AccountType.MANAGER] },
  );
}

export async function PUT(req: NextRequest) {
  return withAuth(
    req,
    async (ctx) => {
      const body = await req.json();
      return toNextResponse(await organizationMemberController.changeRole(ctx, body));
    },
    { allowedAccountTypes: [AccountType.EDUCATOR, AccountType.MANAGER] },
  );
}

export async function DELETE(req: NextRequest) {
  return withAuth(
    req,
    async (ctx) => {
      const { searchParams } = new URL(req.url);
      const targetUserId = searchParams.get('userId') || '';
      return toNextResponse(await organizationMemberController.removeMember(ctx, targetUserId));
    },
    { allowedAccountTypes: [AccountType.EDUCATOR, AccountType.MANAGER] },
  );
}
