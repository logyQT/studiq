import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { invitationController } from '@/server/controllers';

export async function POST(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const body = await req.json();
    const result = await invitationController.accept(ctx, body);

    if (result.success && result.data) {
      const res = toNextResponse(result);
      res.cookies.set('active_org_id', (result.data as { id: string }).id, {
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
        sameSite: 'lax',
      });
      return res;
    }

    return toNextResponse(result);
  });
}
