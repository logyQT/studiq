import { AccountType } from '@studiq/authz';
import { statsController } from '@studiq/server/controllers/stats.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  return withAuth(
    req,
    async (ctx) => {
      const { searchParams } = new URL(req.url);
      const query = Object.fromEntries(searchParams);
      return toNextResponse(await statsController.getTeacherActivityFeed(query, ctx));
    },
    { allowedAccountTypes: [AccountType.EDUCATOR, AccountType.MANAGER] },
  );
}
