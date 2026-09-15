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
      return toNextResponse(await organizationController.getDetails(id));
    },
    { allowedAccountTypes: [AccountType.SYS_ADMIN] },
  );
}
