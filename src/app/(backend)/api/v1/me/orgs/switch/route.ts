import { NextRequest } from 'next/server';
import { orgController } from '@/server/controllers';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';

export async function POST(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const body = await req.json();
    const result = await orgController.switchOrg(ctx, body);

    if (result.success && result.data) {
      const res = toNextResponse(result);
      res.cookies.set('active_org_id', (result.data as { orgId: string }).orgId, {
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
        sameSite: 'lax',
      });
      return res;
    }

    return toNextResponse(result);
  });
}
