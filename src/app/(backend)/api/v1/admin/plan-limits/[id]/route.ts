import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { planLimitController } from '@/server/controllers/plan-limit.controller';

import { AccountType } from '@/types';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth(
    req,
    async () => {
      const body = await req.json();
      const response = await planLimitController.update(id, body);
      return toNextResponse(response);
    },
    { allowedAccountTypes: [AccountType.SYS_ADMIN] },
  );
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth(
    req,
    async () => {
      const response = await planLimitController.delete(id);
      return toNextResponse(response);
    },
    { allowedAccountTypes: [AccountType.SYS_ADMIN] },
  );
}
