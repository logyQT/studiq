import { searchController } from '@studiq/server/controllers/search.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get('q') ?? '';
    const limit = parseInt(searchParams.get('limit') ?? '10', 10);

    const response = await searchController.search({ q, limit }, ctx);
    return toNextResponse(response);
  });
}
