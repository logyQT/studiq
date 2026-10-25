import { AccountType } from '@studiq/authz';
import { aiUsageController } from '@studiq/server/controllers/ai-usage.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => toNextResponse(await aiUsageController.myUsage(ctx)), {
    // Same audience as the chat route it reports on: students (`/app/ai`) and
    // educators (`/edu/ai`). Managers have no AI nav entry.
    allowedAccountTypes: [AccountType.STUDENT, AccountType.EDUCATOR],
  });
}
