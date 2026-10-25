import { authController } from '@studiq/server/controllers/auth.controller';
import { clearActiveOrgCookie } from '@studiq/server/lib/active-org-cookie';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withPublicTracing } from '@studiq/server/lib/with-public-tracing';
import type { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  return withPublicTracing(req, async () => {
    const response = await authController.logout();
    // Always drop the tenant hint: a failed signOut must not leave the previous
    // user's organisation behind for the next session in the same browser (#186).
    return clearActiveOrgCookie(toNextResponse(response));
  });
}
