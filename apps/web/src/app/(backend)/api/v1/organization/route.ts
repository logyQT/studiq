import { AccountType } from '@studiq/authz';
import { organizationController } from '@studiq/server/controllers/organization.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

const COOKIE_OPTIONS = { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' as const };

export async function POST(req: NextRequest) {
  return withAuth(
    req,
    async (ctx) => {
      const body = await req.json();
      const result = await organizationController.createAsMember(body, ctx);

      if (result.success && result.data) {
        const res = toNextResponse(result);
        const orgId = (result.data as { id: string }).id;
        res.cookies.set('active_org_id', orgId, COOKIE_OPTIONS);
        return res;
      }

      return toNextResponse(result);
    },
    { allowedAccountTypes: [AccountType.EDUCATOR, AccountType.MANAGER] },
  );
}
