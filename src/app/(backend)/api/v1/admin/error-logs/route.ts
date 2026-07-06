import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { errorLogController } from '@/server/controllers';
import { AccountType } from '@/types';

export async function GET(req: NextRequest) {
  return withAuth(
    req,
    async () => {
      const response = await errorLogController.list(new URL(req.url).searchParams);
      return toNextResponse(response);
    },
    { allowedAccountTypes: [AccountType.MANAGER] },
  );
}
