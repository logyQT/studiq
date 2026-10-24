import { orgController } from '@studiq/server/controllers/org.controller';
import { setActiveOrgCookie } from '@studiq/server/lib/active-org-cookie';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const body = await req.json();
    const result = await orgController.switchOrg(ctx, body);

    if (result.success && result.data) {
      const res = toNextResponse(result);
      const orgId = (result.data as { orgId: string }).orgId;
      return setActiveOrgCookie(res, orgId);
    }

    return toNextResponse(result);
  });
}
