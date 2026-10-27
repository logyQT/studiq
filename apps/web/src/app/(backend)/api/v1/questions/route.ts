import { questionController } from '@studiq/server/controllers/question.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const body = await req.json();
    return toNextResponse(await questionController.create(body, ctx));
  });
}

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const { searchParams } = new URL(req.url);

    // Blank params mean "not set": the callers build the query string from optional filters.
    const query: Record<string, string> = {};
    for (const key of [
      'bankId',
      'topicIds',
      'type',
      'search',
      'page',
      'limit',
      'sortBy',
      'sortOrder',
    ]) {
      const value = searchParams.get(key);
      if (value) query[key] = value;
    }

    return toNextResponse(await questionController.list(ctx, query));
  });
}
