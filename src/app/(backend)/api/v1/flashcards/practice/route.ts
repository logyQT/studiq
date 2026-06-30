import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';

export async function GET(req: NextRequest) {
  return withAuth(req, async () => {
    return toNextResponse({ success: true, statusCode: 200, data: [] });
  });
}
