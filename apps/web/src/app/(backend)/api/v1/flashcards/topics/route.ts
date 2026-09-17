import { topicController } from '@studiq/server/controllers/topic.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const body = await req.json();
    return toNextResponse(await topicController.create(body, ctx));
  });
}

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const { searchParams } = req.nextUrl;
    const query = {
      q: searchParams.get('q') ?? undefined,
      owner: searchParams.get('owner') ?? undefined,
      sortBy: searchParams.get('sortBy') ?? undefined,
      sortOrder: searchParams.get('sortOrder') ?? undefined,
      cursor: searchParams.get('cursor') ?? undefined,
      limit: searchParams.get('limit') ? Number(searchParams.get('limit')) : undefined,
    };
    return toNextResponse(await topicController.list(query, ctx));
  });
}
