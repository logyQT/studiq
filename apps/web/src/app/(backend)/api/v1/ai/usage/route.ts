import { AccountType } from '@studiq/authz';
import { aiController } from '@studiq/server/controllers/ai.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => toNextResponse(await aiController.getUsage(ctx)), {
    allowedAccountTypes: [AccountType.STUDENT, AccountType.EDUCATOR],
  });
}
