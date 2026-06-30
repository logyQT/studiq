import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { searchController } from '@/server/controllers';

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get('q') ?? '';
    const limit = parseInt(searchParams.get('limit') ?? '10', 10);

    const response = await searchController.search({ q, limit }, ctx);
    return toNextResponse(response);
  });
}
