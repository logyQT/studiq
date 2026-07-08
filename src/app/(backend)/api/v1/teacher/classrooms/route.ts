import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { classroomController } from '@/server/controllers';
import { AccountType } from '@/types';

const COOKIE_OPTIONS = { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' as const };

export async function POST(req: NextRequest) {
  return withAuth(
    req,
    async (ctx) => {
      const body = await req.json();
      const result = await classroomController.create(ctx, body);

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
