import { aiUsageController } from '@studiq/server/controllers/ai-usage.controller';
import { requireEntitlement } from '@studiq/server/lib/entitlements';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    // The same key the chat route and the UI read (ADR-0015 §7: every paid
    // surface's API check is the key the UI reads).
    await requireEntitlement(ctx, 'ai.chat');
    return toNextResponse(await aiUsageController.myUsage(ctx));
  });
}
