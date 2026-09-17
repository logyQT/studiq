import { orgController } from '@studiq/server/controllers/org.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

const COOKIE_OPTIONS = { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' as const };

export async function POST(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const body = await req.json();
    const result = await orgController.switchOrg(ctx, body);

    if (result.success && result.data) {
      const res = toNextResponse(result);
      const orgId = (result.data as { orgId: string }).orgId;
      res.cookies.set('active_org_id', orgId, COOKIE_OPTIONS);
      return res;
    }

    return toNextResponse(result);
  });
}
