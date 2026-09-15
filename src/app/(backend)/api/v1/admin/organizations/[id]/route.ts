import { AccountType } from '@studiq/authz';
import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { organizationController } from '@/server/controllers/organization.controller';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(
    req,
    async () => {
      const { id } = await params;
      return toNextResponse(await organizationController.getById(id));
    },
    { allowedAccountTypes: [AccountType.SYS_ADMIN] },
  );
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(
    req,
    async () => {
      const { id } = await params;
      const body = await req.json();
      return toNextResponse(await organizationController.update(id, body));
    },
    { allowedAccountTypes: [AccountType.SYS_ADMIN] },
  );
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(
    req,
    async () => {
      const { id } = await params;
      return toNextResponse(await organizationController.delete(id));
    },
    { allowedAccountTypes: [AccountType.SYS_ADMIN] },
  );
}
